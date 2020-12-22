'use strict';
var AWS = require('aws-sdk-mock');
var awsSdk = require('aws-sdk');
var LambdaTester = require('lambda-tester');
var chai = require('chai');
var sinonChai = require('sinon-chai');
chai.use(sinonChai);
var expect = chai.expect;
var sinon = require('sinon');

var index = require('../src/index')

describe('stateOfDevOpsDashboardHandler', () => {
    let listPipelineStub;
    let putDashboardSpy;
    const sandbox = sinon.createSandbox();
    function generatePipelines(n: number) {
        return [...Array(n).keys()].map(idx => {
            return {
                name: `service-${idx}-pipeline`,
                version: 1,
                created: '2019-12-27T07:37:13.986Z',
                updated: '2019-12-27T07:37:13.986Z'
            }
        });
    }

    const scenarios = [
        {
            description: 'single pipeline',
            dashboard: '../sample-data/sdo-dashboard-single-pipeline',
            uniquePipelines: 1,
            pipelines: {
                pipelines:
                    [
                        {
                            name: 'flaky-service-pipeline',
                            version: 1,
                            created: '2019-12-27T07:37:13.986Z',
                            updated: '2019-12-27T07:37:13.986Z'
                        }
                    ]
            },
            event: {
                'account': '123456789012',
                'region': 'ap-southeast-2',
                'detail': {},
                'detail-type': 'Scheduled Event',
                'source': 'aws.events',
                'time': '2019-03-01T01:23:45Z',
                'id': 'cdc73f9d-aea9-11e3-9d5a-835b769c0d9c',
                'resources': [
                    'arn:aws:events:ap-southeast-2:123456789012:rule/my-schedule'
                ]
            }
        },
        {
            description: 'multiple pipeline',
            dashboard: '../sample-data/sdo-dashboard-multiple-pipelines',
            uniquePipelines: 2,
            pipelines: {
                pipelines:
                    [
                        {
                            name: 'flaky-service-pipeline',
                            version: 1,
                            created: '2019-12-27T07:37:13.986Z',
                            updated: '2019-12-27T07:37:13.986Z'
                        },
                        {
                            name: 'stable-service-pipeline',
                            version: 1,
                            created: '2019-12-27T07:37:13.986Z',
                            updated: '2019-12-27T07:37:13.986Z'
                        }
                    ]
            },
            event: {
                'account': '123456789012',
                'region': 'ap-southeast-2',
                'detail': {},
                'detail-type': 'Scheduled Event',
                'source': 'aws.events',
                'time': '2019-03-01T01:23:45Z',
                'id': 'cdc73f9d-aea9-11e3-9d5a-835b769c0d9c',
                'resources': [
                    'arn:aws:events:ap-southeast-2:123456789012:rule/my-schedule'
                ]
            }
        },
        {
            description: 'too many pipelines',
            expectTruncated: true,
            uniquePipelines: 50,
            pipelines: {
                pipelines: generatePipelines(50)
            },
            event: {
                'account': '123456789012',
                'region': 'ap-southeast-2',
                'detail': {},
                'detail-type': 'Scheduled Event',
                'source': 'aws.events',
                'time': '2019-03-01T01:23:45Z',
                'id': 'cdc73f9d-aea9-11e3-9d5a-835b769c0d9c',
                'resources': [
                    'arn:aws:events:ap-southeast-2:123456789012:rule/my-schedule'
                ]
            }
        }
    ]

    scenarios.forEach(scenario => {
        describe(scenario.description, () => {
            beforeEach(() => {

                // https://github.com/dwyl/aws-sdk-mock/issues/118
                // Cannot use aws-sdk-mock
                putDashboardSpy = sandbox.stub().returns({
                    promise: () => Promise.resolve()
                })
                listPipelineStub = {
                    listPipelines: (cb) => {
                        cb(null, scenario.pipelines)
                    }
                }
                sandbox.stub(awsSdk, 'CodePipeline').returns(listPipelineStub);

                sandbox.stub(awsSdk, 'CloudWatch').returns({
                    putDashboard: putDashboardSpy
                });

                awsSdk.config.region = 'ap-southeast-2';
            })

            afterEach(() => {
                sandbox.restore();
            })

            it('should generate a dashboard', () => {
                return LambdaTester(index.handler)
                    .event(scenario.event)
                    .expectResult((result, additional) => {
                        expect(putDashboardSpy).to.have.callCount(1);
                    });
            })

            if (scenario.expectTruncated) {
                describe('When there are too many pipelines in the account', () => {
                    it('should report a maximum of 31 pipelines in the dashboard', () => {
                        const consoleSpy = sandbox.spy(console, 'warn')
                        return LambdaTester(index.handler)
                            .event(scenario.event)
                            .expectResult((result, additional) => {
                                expect(consoleSpy).to.have.been.calledWith('Maximum of 31 allowed in a single dashboard.  Some pipelines will not be reported.');
                            });
                    })
                    it('should log a warning when pipelines will not be reported', () => {
                        const consoleSpy = sandbox.spy(console, 'warn')
                        return LambdaTester(index.handler)
                            .event(scenario.event)
                            .expectResult((result, additional) => {
                                expect(consoleSpy).to.have.been.calledWith('Maximum of 31 allowed in a single dashboard.  Some pipelines will not be reported.');
                            });
                    })
                    it('should generate 5 text widgets - to explain each metric + interpretation', () => {
                        return LambdaTester(index.handler)
                            .event(scenario.event)
                            .expectResult((result, additional) => {
                                const dashboard = JSON.parse(putDashboardSpy.getCall(0).args[0].DashboardBody);
                                const textWidgets = dashboard.widgets.filter(w => w.type === 'text');

                                expect(textWidgets.length).to.equal(6);

                            });
                    })
                })
            } else {
                const widgetsPerPipeline = 4;
                it(`should generate ${widgetsPerPipeline} dashboards per pipeline`, () => {

                    return LambdaTester(index.handler)
                        .event(scenario.event)
                        .expectResult((result, additional) => {
                            const dashboard = JSON.parse(putDashboardSpy.getCall(0).args[0].DashboardBody);
                            const metricWidgets = dashboard.widgets.filter(w => w.type === 'metric');

                            expect(metricWidgets.length).to.equal(widgetsPerPipeline * scenario.uniquePipelines);

                        });
                });
                it('should generate 5 text widgets - to explain each metric + interpretation', () => {
                    return LambdaTester(index.handler)
                        .event(scenario.event)
                        .expectResult((result, additional) => {
                            const dashboard = JSON.parse(putDashboardSpy.getCall(0).args[0].DashboardBody);
                            const textWidgets = dashboard.widgets.filter(w => w.type === 'text');

                            expect(textWidgets.length).to.equal(5);

                        });
                })

                it(`should generate the expected dashboard`, () => {
                    const expected = require(scenario.dashboard)
                    return LambdaTester(index.handler)
                        .event(scenario.event)
                        .expectResult((result, additional) => {
                            const dashboard = JSON.parse(putDashboardSpy.getCall(0).args[0].DashboardBody);
                            expect(dashboard, `${JSON.stringify(dashboard)}\n !== \n${JSON.stringify(expected)}`).to.deep.equal(expected);
                        });
                });

                it('For each Pipeline there should be two pipeline metrics and two service health metrics', () => {
                    return LambdaTester(index.handler)
                        .event(scenario.event)
                        .expectResult((result, additional) => {
                            const dashboard = JSON.parse(putDashboardSpy.getCall(0).args[0].DashboardBody);
                            const metricWidgets = dashboard.widgets.filter(w => w.type === 'metric');

                            const pipelineNames = [...new Set(scenario.pipelines.pipelines.map(m => m.name))];
                            pipelineNames.forEach((name, idx) => {
                                const startIdx = idx * widgetsPerPipeline;
                                const widgetsForPipeline = metricWidgets.slice(startIdx, startIdx + widgetsPerPipeline);
                                let pipelineMetricsCounter = 0
                                let serviceHealthMetricsCounter = 0
                                widgetsForPipeline.forEach(widget => {
                                    if (JSON.stringify(widget.properties.metrics).includes(name)) {
                                        pipelineMetricsCounter = pipelineMetricsCounter + 1;
                                    }
                                    if (JSON.stringify(widget.properties.metrics).includes('-service-health')) {
                                        serviceHealthMetricsCounter = serviceHealthMetricsCounter + 1;
                                    }
                                })
                                expect(pipelineMetricsCounter).to.equal(2)
                                expect(serviceHealthMetricsCounter).to.equal(2)
                            })

                        });
                })
            }
        })
    })
})