import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import EventEmitter from 'events';
import rqst from 'request';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import log from 'apify-shared/log';
import { delayPromise } from 'apify-shared/utilities';
import { ENV_VARS } from 'apify-shared/consts';
import Apify from '../build/index';

chai.use(chaiAsPromised);

/* eslint-disable no-underscore-dangle */
describe('CheerioCrawler', () => {
    const comparator = (a, b) => {
        a = Number(/q=(\d+)$/.exec(a.url)[1]);
        b = Number(/q=(\d+)$/.exec(b.url)[1]);
        return a - b;
    };

    let logLevel;

    before(() => {
        logLevel = log.getLevel();
        log.setLevel(log.LEVELS.ERROR);
    });

    after(() => {
        log.setLevel(logLevel);
    });

    it('should work', async () => {
        const sources = [
            { url: 'http://example.com/?q=1' },
            { url: 'http://example.com/?q=2' },
            { url: 'http://example.com/?q=3' },
            { url: 'http://example.com/?q=4' },
            { url: 'http://example.com/?q=5' },
            { url: 'http://example.com/?q=6' },
        ];
        const processed = [];
        const failed = [];
        const requestList = new Apify.RequestList({ sources });
        const handlePageFunction = async ({ $, html, request }) => {
            request.userData.title = $('title').text();
            request.userData.html = html;
            processed.push(request);
        };

        const cheerioCrawler = new Apify.CheerioCrawler({
            requestList,
            minConcurrency: 2,
            maxConcurrency: 2,
            handlePageFunction,
            handleFailedRequestFunction: ({ request }) => failed.push(request),
        });

        await requestList.initialize();
        await cheerioCrawler.run();

        expect(processed).to.have.lengthOf(6);
        expect(failed).to.have.lengthOf(0);

        processed.sort(comparator);
        processed.forEach((request, id) => {
            expect(request.url).to.be.eql(sources[id].url);
            expect(request.userData.title).to.be.eql('Example Domain');
            expect(request.userData.html).to.be.a('string');
            expect(request.userData.html.length).not.to.be.eql(0);
        });
    });

    it('should work with custom request function', async () => {
        const sources = [
            { url: 'http://example.com/?q=0' },
            { url: 'http://example.com/?q=1' },
            { url: 'http://example.com/?q=2' },
            { url: 'http://example.com/?q=3' },
            { url: 'http://example.com/?q=4' },
            { url: 'http://example.com/?q=5' },
            { url: 'http://example.com/?q=6' },
        ];
        const processed = [];
        const failed = [];
        const requestList = new Apify.RequestList({ sources });
        const requestFunction = async ({ request }) => {
            await delayPromise(1);
            return `<html><head><title>${request.url[request.url.length - 1]}</title></head><body>Body</body></html>`;
        };
        const handlePageFunction = async ({ $, html, request }) => {
            request.userData.title = $('title').text();
            request.userData.html = html;
            processed.push(request);
        };

        const cheerioCrawler = new Apify.CheerioCrawler({
            requestList,
            minConcurrency: 2,
            maxConcurrency: 2,
            handlePageFunction,
            requestFunction,
            handleFailedRequestFunction: ({ request }) => failed.push(request),
        });

        await requestList.initialize();
        await cheerioCrawler.run();

        expect(processed).to.have.lengthOf(7);
        expect(failed).to.have.lengthOf(0);

        processed.sort(comparator);
        processed.forEach((request, id) => {
            expect(request.url).to.be.eql(sources[id].url);
            expect(request.userData.title).to.be.eql(String(id));
            expect(request.userData.html).to.be.a('string');
            expect(request.userData.html.length).not.to.be.eql(0);
        });
    });

    describe('should timeout', () => {
        let ll;
        before(() => {
            ll = log.getLevel();
            log.setLevel(log.LEVELS.OFF);
        });

        after(() => {
            log.setLevel(ll);
        });

        it('after requestTimeoutSecs', async () => {
            const sources = [
                { url: 'http://example.com/?q=0' },
                { url: 'http://example.com/?q=1' },
                { url: 'http://example.com/?q=2' },
            ];
            const processed = [];
            const failed = [];
            const requestList = new Apify.RequestList({ sources });
            const requestFunction = async () => {
                await delayPromise(3000);
                return '<html><head></head><body>Body</body></html>';
            };
            const handlePageFunction = async ({ request }) => {
                processed.push(request);
            };

            const cheerioCrawler = new Apify.CheerioCrawler({
                requestList,
                requestTimeoutSecs: 0.05,
                maxRequestRetries: 1,
                minConcurrency: 2,
                maxConcurrency: 2,
                handlePageFunction,
                requestFunction,
                handleFailedRequestFunction: ({ request }) => failed.push(request),
            });

            await requestList.initialize();
            await cheerioCrawler.run();

            expect(processed).to.have.lengthOf(0);
            expect(failed).to.have.lengthOf(3);

            failed.forEach((request) => {
                expect(request.errorMessages).to.have.lengthOf(2);
                expect(request.errorMessages[0]).to.include('requestFunction timed out');
                expect(request.errorMessages[1]).to.include('requestFunction timed out');
            });
        });

        it('after handlePageTimeoutSecs', async () => {
            const sources = [
                { url: 'http://example.com/?q=0' },
                { url: 'http://example.com/?q=1' },
                { url: 'http://example.com/?q=2' },
            ];
            const processed = [];
            const failed = [];
            const requestList = new Apify.RequestList({ sources });
            const handlePageFunction = async ({ request }) => {
                await delayPromise(3000);
                processed.push(request);
            };

            const cheerioCrawler = new Apify.CheerioCrawler({
                requestList,
                handlePageTimeoutSecs: 0.05,
                maxRequestRetries: 1,
                minConcurrency: 2,
                maxConcurrency: 2,
                handlePageFunction,
                handleFailedRequestFunction: ({ request }) => failed.push(request),
            });

            await requestList.initialize();
            await cheerioCrawler.run();

            expect(processed).to.have.lengthOf(0);
            expect(failed).to.have.lengthOf(3);

            failed.forEach((request) => {
                expect(request.errorMessages).to.have.lengthOf(2);
                expect(request.errorMessages[0]).to.include('handlePageFunction timed out');
                expect(request.errorMessages[1]).to.include('handlePageFunction timed out');
            });
        });
    });

    describe('should handle compressed payloads', () => {
        let requestList;
        const originalGet = rqst.get;
        beforeEach(async () => {
            log.setLevel(log.LEVELS.OFF);
            requestList = new Apify.RequestList({
                sources: [
                    { url: 'http://example.com/?q=0' },
                    { url: 'http://example.com/?q=1' },
                    { url: 'http://example.com/?q=2' },
                    { url: 'http://example.com/?q=3' },
                ],
            });
            await requestList.initialize();
        });

        afterEach(() => {
            log.setLevel(log.LEVELS.ERROR);
            requestList = null;
            rqst.get = originalGet;
        });

        it('by setting a correct Accept-Encoding header', async () => {
            const headers = [];
            const crawler = new Apify.CheerioCrawler({
                requestList,
                handlePageFunction: async () => {},
                requestFunction: async ({ request }) => {
                    const opts = crawler._getRequestOptions(request);
                    headers.push(opts.headers);
                    // it needs to return something valid
                    return 'html';
                },
            });

            await crawler.run();
            headers.forEach(h => expect(h['Accept-Encoding']).to.be.eql('gzip, deflate'));
        });

        it('by decompressing a gzip compressed response', async () => {
            const sourceFilePath = path.join(__dirname, 'data', 'sample.html');
            const allHTML = [];
            const crawler = new Apify.CheerioCrawler({
                requestList,
                handlePageFunction: async ({ html }) => {
                    allHTML.push(html);
                },
            });
            // Mock Request to inject a gzipped stream.
            rqst.get = () => {
                const response = fs.createReadStream(sourceFilePath).pipe(zlib.createGzip());
                response.headers = {
                    'content-type': 'text/html', // to avoid throwing
                    'content-encoding': 'gzip',
                };

                const ee = new EventEmitter();

                setTimeout(() => {
                    ee.emit('response', response);
                }, 0);

                return ee;
            };

            await crawler.run();

            const rawHtml = fs.readFileSync(sourceFilePath, 'utf8');
            expect(allHTML).to.have.lengthOf(4);
            allHTML.forEach((html) => {
                expect(html).to.be.eql(rawHtml);
            });
        });

        it('by decompressing a deflate compressed response', async () => {
            const sourceFilePath = path.join(__dirname, 'data', 'sample.html');
            const allHTML = [];
            const crawler = new Apify.CheerioCrawler({
                requestList,
                handlePageFunction: async ({ html }) => {
                    allHTML.push(html);
                },
            });
            // Mock Request to inject a gzipped stream.
            rqst.get = () => {
                const response = fs.createReadStream(sourceFilePath).pipe(zlib.createDeflate());
                response.headers = {
                    'content-type': 'text/html', // to avoid throwing
                    'content-encoding': 'deflate',
                };

                const ee = new EventEmitter();

                setTimeout(() => {
                    ee.emit('response', response);
                }, 0);

                return ee;
            };

            await crawler.run();

            const rawHtml = fs.readFileSync(sourceFilePath, 'utf8');
            expect(allHTML).to.have.lengthOf(4);
            allHTML.forEach((html) => {
                expect(html).to.be.eql(rawHtml);
            });
        });

        it('by throwing on unsupported Content-Encoding', async () => {
            const sourceFilePath = path.join(__dirname, 'data', 'sample.html');
            let handlePageInvocationCount = 0;
            let allErrors = [];
            const crawler = new Apify.CheerioCrawler({
                requestList,
                handlePageFunction: async () => {
                    handlePageInvocationCount++;
                },
                handleFailedRequestFunction: async ({ request }) => {
                    allErrors = allErrors.concat(request.errorMessages);
                },
            });
            // Mock Request to inject a gzipped stream.
            rqst.get = () => {
                const response = fs.createReadStream(sourceFilePath);
                response.headers = {
                    'content-type': 'text/html', // to avoid throwing
                    'content-encoding': 'compress',
                };

                const ee = new EventEmitter();

                setTimeout(() => {
                    ee.emit('response', response);
                }, 0);

                return ee;
            };

            await crawler.run();

            expect(allErrors).to.have.lengthOf(16);
            expect(handlePageInvocationCount).to.be.eql(0);
            allErrors.forEach((err) => {
                expect(err).to.include('Invalid Content-Encoding header');
                expect(err).to.include('compress');
            });
        });
    });

    describe('should ensure text/html Content-Type', () => {
        let requestList;
        beforeEach(async () => {
            requestList = new Apify.RequestList({
                sources: [
                    { url: 'http://example.com/?q=0' },
                    { url: 'http://example.com/?q=1' },
                    { url: 'http://example.com/?q=2' },
                    { url: 'http://example.com/?q=3' },
                ],
            });
            await requestList.initialize();
        });

        afterEach(() => {
            requestList = null;
        });

        it('by setting a correct Accept header', async () => {
            const headers = [];
            const crawler = new Apify.CheerioCrawler({
                requestList,
                handlePageFunction: async () => {},
                requestFunction: async ({ request }) => {
                    const opts = crawler._getRequestOptions(request);
                    headers.push(opts.headers);
                    // it needs to return something valid
                    return 'html';
                },
            });

            await crawler.run();
            headers.forEach(h => expect(h.Accept).to.be.eql('text/html'));
        });

        describe('by throwing', () => {
            let crawler;
            let originalGet;
            let handlePageInvocationCount = 0;
            let errorMessages = [];
            let chunkReadCount = 0;
            const getChunk = (chunk = 'x') => {
                chunkReadCount++;
                return chunk;
            };

            before(() => {
                originalGet = rqst.get;
            });

            after(() => {
                rqst.get = originalGet;
            });

            beforeEach(() => {
                log.setLevel(log.LEVELS.OFF);
                crawler = new Apify.CheerioCrawler({
                    requestList,
                    maxRequestRetries: 1,
                    handlePageFunction: async () => {
                        handlePageInvocationCount++;
                    },
                    handleFailedRequestFunction: async ({ request }) => {
                        errorMessages = [...errorMessages, ...request.errorMessages];
                    },
                });
            });
            afterEach(async () => {
                log.setLevel(log.LEVELS.ERROR);
                crawler = null;
                handlePageInvocationCount = 0;
                chunkReadCount = 0;
                errorMessages = [];
            });


            it('when invalid Content-Type header is received', async () => {
                // Mock Request to inject invalid response headers.
                rqst.get = () => {
                    const response = new Readable({
                        read() {
                            this.push(getChunk());
                            this.push(null);
                        },
                    });
                    response.headers = {
                        'content-type': '000',
                    };

                    const ee = new EventEmitter();

                    setTimeout(() => {
                        ee.emit('response', response);
                    }, 0);

                    return ee;
                };

                await crawler.run();

                expect(handlePageInvocationCount).to.be.eql(0);
                expect(errorMessages).to.have.lengthOf(8);
                errorMessages.forEach(msg => expect(msg).to.include('Invalid Content-Type header'));
                expect(chunkReadCount).to.be.eql(0);
            });

            it('when response stream emits an error event', async () => {
                // Mock Request to emit an error after a while.
                rqst.get = () => {
                    const start = Date.now();
                    const response = new Readable({
                        read() {
                            if (Date.now() > start + 1) {
                                this.emit('error', new Error('Error in stream.'));
                                return;
                            }
                            this.push(getChunk());
                        },
                    });
                    response.headers = {
                        'content-type': 'text/html',
                    };

                    const ee = new EventEmitter();

                    setTimeout(() => {
                        ee.emit('response', response);
                    }, 0);

                    return ee;
                };

                await crawler.run();

                expect(handlePageInvocationCount).to.be.eql(0);
                expect(errorMessages).to.have.lengthOf(8);
                errorMessages.forEach(msg => expect(msg).to.include('Error in stream.'));
            });

            it('when request stream emits an error event', async () => {
                // Mock Request to emit an error after a while.
                rqst.get = () => {
                    const response = new Readable({
                        // Just do nothing
                        read() {},
                    });
                    response.headers = {
                        'content-type': 'text/html',
                    };

                    const ee = new EventEmitter();

                    setTimeout(() => {
                        ee.emit('response', response);
                        setTimeout(() => {
                            ee.emit('error', new Error('Request Error.'));
                        }, 0);
                    }, 0);

                    return ee;
                };

                await crawler.run();

                expect(handlePageInvocationCount).to.be.eql(0);
                expect(errorMessages).to.have.lengthOf(8);
                errorMessages.forEach(msg => expect(msg).to.include('Request Error.'));
            });

            it('when statusCode >= 500 and text/html is received', async () => {
                rqst.get = () => {
                    const response = new Readable({
                        read() {
                            this.push(getChunk());
                            this.push(null);
                        },
                    });
                    response.headers = {
                        'content-type': 'text/html',
                    };
                    response.statusCode = 500;

                    const ee = new EventEmitter();

                    setTimeout(() => {
                        ee.emit('response', response);
                    }, 0);

                    return ee;
                };

                await crawler.run();

                expect(handlePageInvocationCount).to.be.eql(0);
                expect(errorMessages).to.have.lengthOf(8);
                errorMessages.forEach(msg => expect(msg).to.include('Internal Server Error: x'));
                expect(chunkReadCount).to.be.eql(8);
            });

            it('when statusCode >= 500 and application/json is received', async () => {
                rqst.get = () => {
                    const response = new Readable({
                        // Just do nothing
                        read() {
                            this.push(getChunk(JSON.stringify({ message: 'Hello' })));
                            this.push(null);
                        },
                    });
                    response.headers = {
                        'content-type': 'application/json',
                    };
                    response.statusCode = 500;

                    const ee = new EventEmitter();

                    setTimeout(() => {
                        ee.emit('response', response);
                    }, 0);

                    return ee;
                };

                await crawler.run();

                expect(handlePageInvocationCount).to.be.eql(0);
                expect(errorMessages).to.have.lengthOf(8);
                errorMessages.forEach(msg => expect(msg).to.include('500 - Hello'));
                expect(chunkReadCount).to.be.eql(8);
            });

            it('when 406 is received', async () => {
                // Mock Request to respond with a 406.
                rqst.get = () => {
                    const response = new Readable({
                        read() {
                            this.push(getChunk());
                            this.push(null);
                        },
                    });
                    response.headers = {
                        'content-type': 'text/plain',
                    };
                    response.statusCode = 406;

                    const ee = new EventEmitter();

                    setTimeout(() => {
                        ee.emit('response', response);
                    }, 0);

                    return ee;
                };

                await crawler.run();

                expect(handlePageInvocationCount).to.be.eql(0);
                expect(errorMessages).to.have.lengthOf(4);
                errorMessages.forEach(msg => expect(msg).to.include('is not available in HTML format'));
                expect(chunkReadCount).to.be.eql(0);
            });

            it('when status is ok, but a wrong content type is received', async () => {
                // Mock Request to respond with a 406.
                rqst.get = () => {
                    const response = new Readable({
                        read() {
                            this.push(getChunk());
                            this.push(null);
                        },
                    });
                    response.headers = {
                        'content-type': 'application/json',
                    };
                    response.statusCode = 200;

                    const ee = new EventEmitter();

                    setTimeout(() => {
                        ee.emit('response', response);
                    }, 0);

                    return ee;
                };

                await crawler.run();

                expect(handlePageInvocationCount).to.be.eql(0);
                expect(errorMessages).to.have.lengthOf(4);
                errorMessages.forEach(msg => expect(msg).to.include('served Content-Type application/json instead of text/html'));
                expect(chunkReadCount).to.be.eql(0);
            });
        });
    });

    describe('proxy', () => {
        let requestList;
        beforeEach(async () => {
            requestList = new Apify.RequestList({
                sources: [
                    { url: 'http://example.com/?q=0' },
                    { url: 'http://example.com/?q=1' },
                    { url: 'http://example.com/?q=2' },
                    { url: 'http://example.com/?q=3' },
                ],
            });
            await requestList.initialize();
        });

        afterEach(() => {
            requestList = null;
        });

        it('should work with proxyUrls array', async () => {
            const proxies = [];
            const crawler = new Apify.CheerioCrawler({
                requestList,
                handlePageFunction: async () => {},
                requestFunction: async ({ request }) => {
                    const opts = crawler._getRequestOptions(request);
                    proxies.push(opts.proxy);
                    // it needs to return something valid
                    return 'html';
                },
                proxyUrls: ['http://proxy.com:1111', 'http://proxy.com:2222', 'http://proxy.com:3333'],
            });

            const shuffled = crawler.proxyUrls;
            await crawler.run();

            expect(proxies).to.have.lengthOf(4);
            expect(proxies[0]).to.be.eql(shuffled[0]);
            expect(proxies[1]).to.be.eql(shuffled[1]);
            expect(proxies[2]).to.be.eql(shuffled[2]);
            expect(proxies[3]).to.be.eql(shuffled[0]);
        });

        it('should work with useApifyProxy', async () => {
            process.env[ENV_VARS.PROXY_PASSWORD] = 'abc123';
            const proxies = [];
            const useApifyProxy = true;

            const proxy = Apify.getApifyProxyUrl();

            const crawler = new Apify.CheerioCrawler({
                requestList,
                handlePageFunction: async () => {},
                requestFunction: async ({ request }) => {
                    const opts = crawler._getRequestOptions(request);
                    proxies.push(opts.proxy);
                    // it needs to return something valid
                    return 'html';
                },
                useApifyProxy,
            });

            await crawler.run();
            delete process.env[ENV_VARS.PROXY_PASSWORD];

            // expect(proxies).to.have.lengthOf(1);
            expect(proxies[0]).to.be.eql(proxy);
            expect(proxies[1]).to.be.eql(proxy);
            expect(proxies[2]).to.be.eql(proxy);
            expect(proxies[3]).to.be.eql(proxy);
        });

        it('should work with useApifyProxy and other opts', async () => {
            process.env[ENV_VARS.PROXY_PASSWORD] = 'abc123';
            const proxies = [];
            const useApifyProxy = true;
            const apifyProxyGroups = ['GROUP1', 'GROUP2'];
            const apifyProxySession = 'session';

            const proxy = Apify.getApifyProxyUrl({
                groups: apifyProxyGroups,
                session: apifyProxySession,
            });

            const crawler = new Apify.CheerioCrawler({
                requestList,
                handlePageFunction: async () => {},
                requestFunction: async ({ request }) => {
                    const opts = crawler._getRequestOptions(request);
                    proxies.push(opts.proxy);
                    // it needs to return something valid
                    return 'html';
                },
                useApifyProxy,
                apifyProxyGroups,
                apifyProxySession,
            });

            await crawler.run();
            delete process.env[ENV_VARS.PROXY_PASSWORD];

            // expect(proxies).to.have.lengthOf(1);
            expect(proxies[0]).to.be.eql(proxy);
            expect(proxies[1]).to.be.eql(proxy);
            expect(proxies[2]).to.be.eql(proxy);
            expect(proxies[3]).to.be.eql(proxy);
        });

        describe('throws', () => {
            /* eslint-disable no-new */
            beforeEach(() => {
                log.setLevel(log.LEVELS.OFF);
            });
            afterEach(async () => {
                log.setLevel(log.LEVELS.ERROR);
            });

            it('when proxyUrls is used together with useApifyProxy', async () => {
                try {
                    new Apify.CheerioCrawler({
                        requestList,
                        handlePageFunction: async () => {},
                        requestFunction: async () => {},
                        proxyUrls: ['http://proxy.com:1111', 'http://proxy.com:2222', 'http://proxy.com:3333'],
                        useApifyProxy: true,
                    });
                    throw new Error('Invalid error.');
                } catch (err) {
                    expect(err.message).to.include('useApifyProxy');
                }
            });

            it('when proxyUrls array is empty', async () => {
                try {
                    new Apify.CheerioCrawler({
                        requestList,
                        handlePageFunction: async () => {},
                        requestFunction: async () => {},
                        proxyUrls: [],
                    });
                    throw new Error('Invalid error.');
                } catch (err) {
                    expect(err.message).to.include('must not be empty');
                }
            });
        });
    });

    // It would make sense to also test that the listener does not prevent other
    // uncaught exceptions from exiting the process, but since the exceptions
    // thrown from within the listener cannot be caught anymore, there's no way
    // to do this, because the re-thrown error will always crash the test process.
    describe('tunnel-agent error handler', () => {
        const throwNextTick = (err) => {
            process.nextTick(() => {
                throw err;
            });
        };

        let mochaListener;

        before(() => {
            log.setLevel(log.LEVELS.OFF);
            mochaListener = process.listeners('uncaughtException').shift();
            process.removeListener('uncaughtException', mochaListener);
        });
        after(() => {
            log.setLevel(log.LEVELS.ERROR);
            process.on('uncaughtException', mochaListener);
        });

        it('should suppress tunnel-agent errors', async () => {
            let handlePageCalled = false;
            let handleFailedRequestCallCount = 0;

            const requestList = new Apify.RequestList({
                sources: [
                    { url: 'http://example.com/?q=0' },
                    { url: 'http://example.com/?q=1' },
                    { url: 'http://example.com/?q=2' },
                    { url: 'http://example.com/?q=3' },
                ],
            });

            const crawler = new Apify.CheerioCrawler({
                requestList,
                requestFunction: async () => {
                    const err = new Error();
                    err.code = 'ERR_ASSERTION';
                    err.name = 'AssertionError [ERR_ASSERTION]';
                    err.operator = '==';
                    err.expected = 0;
                    err.stack = ('xxx/tunnel-agent/index.js/yyyy');
                    throwNextTick(err);
                    // will never resolve
                    await new Promise((r, rj) => {}); // eslint-disable-line no-unused-vars
                },
                requestTimeoutSecs: 1 / 1000,
                handlePageFunction: () => {
                    handlePageCalled = true;
                },
                handleFailedRequestFunction: () => {
                    handleFailedRequestCallCount++;
                },
            });

            await requestList.initialize();
            await crawler.run();

            expect(handlePageCalled).to.be.eql(false);
            expect(handleFailedRequestCallCount).to.be.eql(4);
        });
    });
});
