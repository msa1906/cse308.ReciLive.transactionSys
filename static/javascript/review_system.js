// dependence: jquery, bluebird

function TransactionSystem(path) {
    var self = this;
    var connection;
    var transactions = [];
    var latestReady = null;
    var modules = {};
    var live = true;
    
    var watchdog = null; // used for non live update
    var pastaTime = null;// user chosen time in transaction record
    var currentTime = null;// current time when user click on replay or review button
    var currentPlayedIndex = 0;
    //TODO: change current time to relative time soon™
    this.privilege = null; // assign by outside
    this.userID = null; // assign by outside
    
    this.init = function () {
        connection = new wsConnection(path, sendStart, receive, false);
        var ready, fail;
        latestReady = new Promise(function (resolve, reject) {
            ready = resolve;
            fail = reject;
        });
        latestReady.ready = ready;
        latestReady.fail = fail;
        connection.connect();
        return latestReady;
    };
    function sendStart() {
        connection.send(JSON.stringify({
            type: "initialization",
            startAt: ((transactions.length > 0) ? transactions.length : 0)
        }));
    }
    
    function watchdogHandler() {
        console.assert(!live);
        var currentTimeOffset = new Date() - currentTime;
        var pastaCurrentTime = new Date(currentTimeOffset + pastaTime);
        for (var i = currentPlayedIndex + 1; i < transactions.length; i++) {
            if (transactions[i].createdAt < pastaCurrentTime) {
                modules[transactions[i].module].update(i,
                    transactions[i].description,
                    transactions[i].createdBy,
                    transactions[i].createdAt,
                    transactions[i].payload);
                
            } else {
                if(currentPlayedIndex < i) currentPlayedIndex = i-1;
                return;
            }
        }
        if(currentPlayedIndex < i) currentPlayedIndex = i;
        console.log('replay session is over (UI is needed)');
        // TODO: Added vex dialog
        clearInterval(watchdog);
    }
    
    this.switchTime = function (time) {
        function findKeyTransaction(moduleName, time, isNotIncremental) {
            if (isNotIncremental) {
                for (var i = transactions.length - 1; i >= 0; i--) {
                    if (transactions[i].module == moduleName && time >= transactions[i].createdAt) {
                        return i;
                    }
                }
                return -1;
            } else {
                return 0; // TODO: find transaction
            }
        }
        
        //check time param
        if (!time && live)return;
        //TODO: time greater than latest transaction
        if (!time) {
            // switch to live
            live = true;
            modules.forEach(function (module) {
                console.assert(module.reset);
                module.reset();
                if (module.isNotIncremental) {
                    var keyTrans = findKeyTransaction(module.moduleName, new Date(), true);
                    if (keyTrans < 0) return;
                    module.update(keyTrans,
                        transactions[keyTrans].description,
                        transactions[keyTrans].createdBy,
                        transactions[keyTrans].createdAt,
                        transactions[keyTrans].payload);
                }
                else {
                    var keyTrans = findKeyTransaction(module.moduleName, new Date(), false);
                    if (keyTrans < 0)return;//-1
                    for (var j = keyTrans; j < transactions.length; j++) {
                        if (transactions[j].module == module.moduleName) {
                            module.update(j,
                                transactions[j].description,
                                transactions[j].createdBy,
                                transactions[j].createdAt,
                                transactions[j].payload);
                        }
                    }
                }
            });
            clearInterval(watchdog);
        } else {
            // switch to this time
            live = false;
            pastaTime = time;
            currentTime = new Date();
            modules.forEach(function (module) {
                console.assert(module.reset);
                module.reset();
                if (module.isNotIncremental) {
                    var keyTrans = findKeyTransaction(module.moduleName, time, true);
                    if (keyTrans < 0) return;
                    module.update(keyTrans,
                        transactions[keyTrans].description,
                        transactions[keyTrans].createdBy,
                        transactions[keyTrans].createdAt,
                        transactions[keyTrans].payload);
                    if(currentPlayedIndex < keyTrans) currentPlayedIndex = keyTrans;
                }
                else {
                    var keyTrans = findKeyTransaction(module.moduleName, time, false);
                    if (keyTrans < 0)return;//-1
                    for (var j = keyTrans; j < transactions.length; j++) {
                        if(time>transactions[j].createdAt) {
                            if(currentPlayedIndex < j) currentPlayedIndex = j;
                            break;
                        }
                        if (transactions[j].module == module.moduleName) {
                            module.update(j,
                                transactions[j].description,
                                transactions[j].createdBy,
                                transactions[j].createdAt,
                                transactions[j].payload);
                        }
                    }
                    console.assert(j == transactions.length, "you are too fasssssst");
                }
            });
            watchdog = setInterval(watchdogHandler, 50);
        }
    };
    
    function receive(e) {
        var object = JSON.parse(e.data);
        if (object.type == 'latest_sent') {
            latestReady.ready();
        } else if (object.index == ((transactions.length > 0) ? transactions.length : 0)) {
            //transactions.push(object);
            transactions[object.index] = object;
            if (live) modules[object.module].update(object.index,
                object.description,
                object.createdBy,
                object.createdAt,
                object.payload);
        } else {
            console.error('transaction receive out of order');
            connection.reset();
        }
        // TODO: process error message
    }
    
    this.registerModule = function (moduleName, module) {
        modules[moduleName] = module;
    };
    
    this.newTransaction = function (module, description, payload) {
        var attemptInterval = 200;
        
        function sendAttempt(err) {
            return new Promise(function (resolve, reject) {
                var index = ((transactions.length > 0) ? transactions.length : 0);
                var transaction = {
                    index: index,
                    module: module,
                    description: description,
                    payload: payload
                };
                $.ajax({
                    url: window.location.href + '/transaction_post',
                    type: 'post',
                    data: JSON.stringify(transaction),
                    contentType: "application/json; charset=utf-8",
                    dataType: 'json',
                }).done(function (result) {
                    if (result.status == 'ok')
                        return resolve({index: index});
                    else
                        return reject(result);
                }).fail(function (err) {
                    return reject(err);
                });
            });
        }
        
        function failDelay(err) {
            return new Promise(function (resolve, reject) {
                if (err.reason == 1)
                    console.log('transaction conflict, retrying. ');
                else
                    console.error('failDelay captured error: ' + err.toString());
                setTimeout(reject.bind(null, err), attemptInterval);
            });
        }
        
        var p = Promise.reject(new Error('nothing is wrong'));
        for (var i = 0; i < 10; i++) {
            p = p.catch(sendAttempt).catch(failDelay);
        }
        p.catch(function (err) {
            console.error('newTransaction retry reach maximum');
            throw 'newTransaction retry reach maximum';
        });
        return p;
    };
    
}

function transaction() {
    this.index = null;
    this.createdAt = null;
    this.createdBy = null;
    this.module = null;
    this.description = {};
    this.payload = null;
}

function wsConnection(destination, onConnectCallback, receiveCallback, resend) {
    var self = this;
    var ws;
    var reconnectPending = false;
    
    this.connect = function () {
        // console.error('connect called');
        ws = createWebSocket(destination);
        ws.addEventListener("open", function (e) {
            onConnectCallback(e);
        });
        ws.addEventListener("message", function (e) {
            receiveCallback(e);
        });
        ws.addEventListener('close', function () {
            if (!reconnectPending) {
                console.log('connection to %s closed, reconnect in 1 second', destination);
                setTimeout(()=> {
                    self.connect();
                    reconnectPending = false;
                }, 1000);
                reconnectPending = true;
            }
        });
        ws.addEventListener('error', function () {
            if (!reconnectPending) {
                console.log('connection to %s failed, reconnect in 3 second', destination);
                ws.close();
                setTimeout(()=> {
                    self.connect();
                    reconnectPending = false;
                }, 3000);
                reconnectPending = true;
            }
        });
    };
    
    function createWebSocket(path) {
        var protocolPrefix = (window.location.protocol === 'https:') ? 'wss:' : 'ws:';
        return new WebSocket(protocolPrefix + '//' + location.host + path, 'transaction');
    }
    
    this.send = function (data) {
        if (ws.readyState != ws.OPEN && ws.readyState != ws.CONNECTING) {
            console.log('writing while websocket is not opened, reconnect in 0,5 second');
            if (!reconnectPending) {
                setTimeout(()=> {
                    self.connect();
                    reconnectPending = false;
                }, 500);
                reconnectPending = true;
            }
            if (resend) {
                ws.addEventListener('open', function (e) {
                    // remove current event listener
                    e.target.removeEventListener(e.type, arguments.callee);
                    ws.send(data);
                });
            }
        } else {
            ws.send(data);
        }
    };
    
    this.reset = function () {
        ws.close();
        
    };
}

function module(transactionSystem) {
    
    this.update = function (index, description, createdBy, createdAt, payload) {
        
    };
    this.reset = function () {
        
    };
}