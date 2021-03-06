/* eslint-disable quotes */
import * as AWSMock from "aws-sdk-mock";
import { handler } from "../src/stateChangeHandler";
import { CloudwatchStateChangeEvent } from "../src/interface.d";
import { AlarmHistoryItem, AlarmHistoryItems } from "aws-sdk/clients/cloudwatch";
import * as alarmEventStore from "../src/alarmEventStore";

describe("stateChangeCapture", () => {
    let dynamoPutSpy;
    let eventStoreSpy;
    let SSMGetParameterSpy;
    let alarmHistory: AlarmHistoryItems;
    process.env.TABLE_NAME = "MetricsEventStore";

    beforeEach(() => {
        setup();
    });

    afterEach(() => {
        AWSMock.restore();
        eventStoreSpy.mockRestore();
    });

    describe("when previous state exists", () => {
        it("should set value to -1 when alarm state changes to OK", async () => {
            await whenHandlerInvoked(givenPreviousStateExistsInDynamo("OK", "ALARM"));
            const expected = {
                Item: {
                    id: "ALARM_app1-service-alarm",
                    resourceId: "2019-12-12T06:25:41.200+0000",
                    appName: "app1",
                    bookmarked: "N",
                    state: "OK",
                    value: -1,
                },
                TableName: "MetricsEventStore",
            };
            expect(dynamoPutSpy).toBeCalledWith(expected);
        });

        it("should set value to 1 when alarm state changes to ALARM", async () => {
            await whenHandlerInvoked(givenPreviousStateExistsInDynamo("ALARM", "OK"));
            const expected = {
                Item: {
                    id: "ALARM_app1-service-alarm",
                    resourceId: "2019-12-12T06:25:41.200+0000",
                    appName: "app1",
                    bookmarked: "N",
                    state: "ALARM",
                    value: 1,
                },
                TableName: "MetricsEventStore",
            };
            expect(dynamoPutSpy).toBeCalledWith(expected);
        });

        it("should not store the event when previous and current state are both ALARM", async () => {
            await whenHandlerInvoked(givenPreviousStateExistsInDynamo("ALARM", "ALARM"));
            expect(dynamoPutSpy).not.toBeCalled();
        });

        it("should not store the event when previous and current state are both OK", async () => {
            await whenHandlerInvoked(givenPreviousStateExistsInDynamo("OK", "OK"));
            expect(dynamoPutSpy).not.toBeCalled();
        });
    });

    describe("When no previous dynamo DB record", () => {
        describe("When state changes", () => {
            it("should set value to 0 when alarm state is OK", async () => {
                await whenHandlerInvoked(givenNoPreviousStateInDynamo("OK", "ALARM"));
                const expected = {
                    Item: {
                        id: "ALARM_app1-service-alarm",
                        resourceId: "2019-12-12T06:25:41.200+0000",
                        appName: "app1",
                        bookmarked: "N",
                        state: "OK",
                        value: 0,
                    },
                    TableName: "MetricsEventStore",
                };
                expect(dynamoPutSpy).toBeCalledWith(expected);
            });

            it("should set value to 1 when alarm state is ALARM", async () => {
                await whenHandlerInvoked(givenNoPreviousStateInDynamo("ALARM", "OK"));
                const expected = {
                    Item: {
                        id: "ALARM_app1-service-alarm",
                        resourceId: "2019-12-12T06:25:41.200+0000",
                        appName: "app1",
                        bookmarked: "N",
                        state: "ALARM",
                        value: 1,
                    },
                    TableName: "MetricsEventStore",
                };
                expect(dynamoPutSpy).toBeCalledWith(expected);
            });

            it("should still find the correct app name when alarmName has prefix", async () => {
                const alarmStateEvent: CloudwatchStateChangeEvent = {
                    ...givenNoPreviousStateInDynamo("ALARM", "OK"),
                };
                alarmStateEvent.detail.alarmName = "app1-service-dynamodb-health-monitoring";
                await whenHandlerInvoked(alarmStateEvent);
                const expected = {
                    Item: {
                        id: "ALARM_app1-service-dynamodb-health-monitoring",
                        resourceId: "2019-12-12T06:25:41.200+0000",
                        appName: "app1",
                        bookmarked: "N",
                        state: "ALARM",
                        value: 1,
                    },
                    TableName: "MetricsEventStore",
                };
                expect(dynamoPutSpy).toBeCalledWith(expected);
            });

            it("should make api call to retrieve the pipeline name ", async () => {
                await whenHandlerInvoked(givenNoPreviousStateInDynamo("ALARM", "OK"));
                expect(SSMGetParameterSpy).toBeCalled();
            });
        });

        describe("When state is the same", () => {
            it("should not make any api calls when current and previous states are both ALARM", async () => {
                await whenHandlerInvoked(givenNoPreviousStateInDynamo("ALARM", "ALARM"));
                expect(SSMGetParameterSpy).not.toBeCalled();
                expect(dynamoPutSpy).not.toBeCalled();
            });
            it("should not make any api calls when current and previous states are both OK", async () => {
                await whenHandlerInvoked(givenNoPreviousStateInDynamo("OK", "OK"));
                expect(SSMGetParameterSpy).not.toBeCalled();
                expect(dynamoPutSpy).not.toBeCalled();
            });
        });

        it("should ignore the state when it is insufficient data", async () => {
            await whenHandlerInvoked(givenNoPreviousStateInDynamo("INSUFFICIENT_DATA", "OK"));
            expect(SSMGetParameterSpy).not.toBeCalled();
            expect(dynamoPutSpy).not.toBeCalled();
        });

        it("should ignore alarms if alarmName ends with -service-health", async () => {
            const event: CloudwatchStateChangeEvent = givenNoPreviousStateInDynamo("OK", "ALARM");
            event.detail.alarmName = "app1-service-service-health";
            await whenHandlerInvoked(event);
            expect(dynamoPutSpy).not.toBeCalled();
        });
    });

    function givenNoPreviousStateInDynamo(currentState: string, prevState: string) {
        const alarmStateEvent: CloudwatchStateChangeEvent = { ...mockCloudwatchEvent };
        mockReturnEmptyItemFromDynamo();
        const items = [
            {
                date: "2019-01-02T00:02:30.000Z",
                state: prevState,
                oldSate: "INSUFFICIENT_DATA",
            },
            {
                date: "2019-01-03T00:02:30.000Z",
                state: "INSUFFICIENT_DATA",
                oldSate: prevState,
            },
            {
                date: "2019-01-04T00:02:30.000Z",
                state: currentState,
                oldSate: "INSUFFICIENT_DATA",
            },
        ];
        mockCloudwatchHistory(items);
        alarmStateEvent.detail.state.value = currentState;
        return alarmStateEvent;
    }

    async function whenHandlerInvoked(alarmStateEvent: CloudwatchStateChangeEvent) {
        await handler(alarmStateEvent);
    }

    function givenPreviousStateExistsInDynamo(currentState: string, prevState: string) {
        const alarmStateEvent: CloudwatchStateChangeEvent = { ...mockCloudwatchEvent };
        mockGetLastItemFromDynamo(prevState);
        alarmStateEvent.detail.state.value = currentState;
        return alarmStateEvent;
    }

    function setup() {
        dynamoPutSpy = jest.fn().mockReturnValue({});

        alarmHistory = [];
        eventStoreSpy = jest.spyOn(alarmEventStore, "getLastItemById");
        SSMGetParameterSpy = jest.fn().mockReturnValue({
            Parameters: [
                {
                    Name: "/state-of-devops/app-names",
                    Type: "StringList",
                    Value: "app1,app2",
                    Version: 3,
                    LastModifiedDate: "2021-01-14T00:27:16.013Z",
                    ARN: "arn:aws:ssm:ap-southeast-2:319524684326:parameter/state-of-devops/app-names",
                    DataType: "text",
                },
            ],
            InvalidParameters: [],
        });
        AWSMock.mock("SSM", "getParameters", (params, callback) => {
            callback(null, SSMGetParameterSpy(params));
        });
        AWSMock.mock("DynamoDB.DocumentClient", "put", (params, callback) => {
            callback(null, dynamoPutSpy(params));
        });
    }

    function mockCloudwatchHistory(items) {
        const alarmHistoryResp = {
            AlarmHistoryItems: alarmHistory,
        };

        items.forEach((row) => {
            const history = {
                version: "1.0",
                oldState: {
                    stateValue: row.oldState,
                    stateReason: "blah",
                },
                newState: {
                    stateValue: row.state,
                    stateReason: "more blah",
                    stateReasonData: {
                        version: "1.0",
                        queryDate: "2019-05-27T08:17:07.386+0000",
                        startDate: "2019-05-27T07:57:00.000+0000",
                        statistic: "Average",
                        period: 300,
                        recentDatapoints: [0.0, 0.0, 0.0],
                        threshold: 0,
                    },
                },
            };
            const item: AlarmHistoryItem = {
                Timestamp: row.date,
                HistoryItemType: "StateUpdate",
                AlarmName: "app1-service",
                HistoryData: JSON.stringify(history),
                HistorySummary: "not important",
            };
            alarmHistory.push(item);
        });
        AWSMock.mock("CloudWatch", "describeAlarmHistory", alarmHistoryResp);
    }

    function mockGetLastItemFromDynamo(prevState: string) {
        eventStoreSpy.mockImplementation((params) => {
            console.log("params are:", JSON.stringify(params));
            if (params !== "ALARM_app1-service-alarm") {
                throw new Error("Incorrect parameter is passed to getLastItemById query");
            }
            return {
                Items: [
                    {
                        id: "ALARM_app1-service-alarm",
                        resourceId: "2019-12-12T06:25:41.200+0000",
                        appname: "app1",
                        value: -1,
                        state: prevState,
                    },
                ],
                Count: 1,
                ScannedCount: 1,
                LastEvaluatedKey: { id: "ALARM_app1-service", resourceId: "1577082070_app2" },
            };
        });
    }

    function mockReturnEmptyItemFromDynamo() {
        eventStoreSpy.mockImplementation(
            jest.fn().mockReturnValue({
                Items: [],
                Count: 0,
                ScannedCount: 0,
            }),
        );
    }
});

const alarmDetail = {
    alarmName: "app1-service-alarm",
    state: {
        value: "OK",
        reason:
            "Threshold Crossed: 1 out of the last 1 datapoints [2.0 (18/11/19 07:02:00)] was greater than the threshold (0.0) (minimum 1 datapoint for OK -> ALARM transition).",
        reasonData:
            '{"version":"1.0","queryDate":"2019-11-18T07:03:51.700+0000","startDate":"2019-11-18T07:02:00.000+0000","statistic":"Sum","period":60,"recentDatapoints":[2.0],"threshold":0.0}',
        timestamp: "2019-12-12T06:25:41.200+0000",
    },
    previousState: {
        value: "INSUFFICIENT_DATA",
        reason:
            "Threshold Crossed: 1 out of the last 1 datapoints [0.0 (18/11/19 06:56:00)] was not greater than the threshold (0.0) (minimum 1 datapoint for ALARM -> OK transition).",
        reasonData:
            '{"version":"1.0","queryDate":"2019-11-18T06:57:51.670+0000","startDate":"2019-11-18T06:56:00.000+0000","statistic":"Sum","period":60,"recentDatapoints":[0.0],"threshold":0.0}',
        timestamp: "2019-11-18T06:57:51.679+0000",
    },
    configuration: {
        description: "Example alarm for a app1 service - demonstrate capturing metrics based on alarms.",
    },
};

const mockCloudwatchEvent: CloudwatchStateChangeEvent = {
    version: "0",
    id: "abcdfgh-7edc-nmop-qrst-efghjkl",
    "detail-type": "CloudWatch Alarm State Change",
    source: "aws.cloudwatch",
    account: "12345",
    time: "2019-11-18T07:03:51Z",
    region: "ap-southeast-2",
    resources: ["arn:aws:cloudwatch:ap-southeast-2:12345:alarm:app1-service"],
    detail: alarmDetail,
};
