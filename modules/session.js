var When = require('when');
var Cookie = require('cookie');
var assert = require('assert');
var EventEmitter = require('events');
var s = global.s;

exports.session = function () {
    var self = this;
    var lastTransactionIndex = -1;
    self.sessionID = -1;
    self.privilege = null;
    self.name = null;
    self.startDate = null;
    self.endDate = null;
    self.status = null;

    var clients = {};
    var clientsInInit = {}; // element: last send index

    this.newSession = function (param) {
        if (self.sessionID >= 0) return When.reject({reason: "reinitialization of session:" + self.sessionID});

        self.sessionID = param.sessionID;
        self.privilege = param.privilege;
        self.name = param.name;
        self.startDate = param.startDate;
        self.endDate = param.endDate;
        self.status = param.status;

        return s.transactionRecord.addSession({
            sessionID: self.sessionID,
            privilege: self.privilege,
            name: self.name,
            startDate: self.startDate,
            endDate: self.endDate,
            status: self.status
        }).then((value)=> {
            s.wsHandler.addRoute("/room/" + self.sessionID + "/transaction", self.wsHandleTransaction);
            s.wsHandler.addRoute("/room/" + self.sessionID + "/sound", self.wsHandleSound);
            return value;
        });
    };
    this.resumeSession = function (param) {
        if (self.sessionID >= 0) return When.reject({reason: "reinitialization of session:" + self.sessionID});

        self.sessionID = param.sessionID;
        self.privilege = param.privilege;
        self.name = param.name;
        self.startDate = param.startDate;
        self.endDate = param.endDate;
        self.status = param.status;

        return s.transactionRecord.getLastTransactionIndex({sessionID: self.sessionID})
            .then((index)=> {
                lastTransactionIndex = index;
            })
            .then((value)=> {
                s.wsHandler.addRoute("/room/" + self.sessionID + "/transaction", self.wsHandleTransaction);
                s.wsHandler.addRoute("/room/" + self.sessionID + "/sound", self.wsHandleSound);
                if(!s.inProduction){
                    console.log("new session resumed");
                    console.log(param);
                    console.log("last index: " + lastTransactionIndex);
                }
                return value;
            });
    };

    this.wsHandleTransaction = function (ws) {
        log.debug('start transaction wsHandler for '+self.sessionID);
        ws.roomSession = self;
        clientsInInit[ws] = -1;

        function socketPanic(reason) {
            ws.send(JSON.stringify({type:"error", reason: reason}));
            delete clients[ws];
            delete clientsInInit[ws];
            ws.close();
        }

        function sendToTheLatest(startAt){
            var resultEvent = new EventEmitter();
            function send(doc) {
                if(doc) {
                    assert(doc.index == clientsInInit[ws]+1);
                    ws.send(JSON.stringify({
                        type:"transaction_push",
                        index: doc.index,
                        module: doc.module,
                        description: doc.description,
                        createdAt: doc.createdAt,
                        createdBy: doc.createdBy,
                        payload: doc.payload
                    }));
                    clientsInInit[ws]++;
                    return true;
                }else{
                    assert(clientsInInit[ws]<=lastTransactionIndex);
                    if(clientsInInit[ws] == lastTransactionIndex){
                        delete clientsInInit[ws];
                        clients[ws] = true;
                        resultEvent.emit('done');
                    }else{
                        if(!s.inProduction) console.log('missed latest transaction, requerying. ');
                        sendToTheLatest(clientsInInit[ws]+1);
                    }
                    return false;
                }
            }
            self.listTransaction(startAt, send);
            return resultEvent;
        }

        ws.on('message', function (message) {
            try{message = JSON.parse(message)}
            catch(e){
                if(!s.inProduction) console.error("receive abnormal message from websocket: " + message);
                return socketPanic(5);
            }
            if(message.type == "initialization" && typeof message.startAt == "number"){
                sendToTheLatest(message.startAt).on('done', function () {
                    ws.send(JSON.stringify({
                        type: 'latest_sent'
                    }));
                });
            }else{
                if(!s.inProduction) console.error("receive abnormal message format from websocket: " + message);
                return socketPanic(5);
            }
        });
        ws.on('close', function () {
            delete clients[ws];
            delete clientsInInit[ws];
            ws.close();
        });
    };

    this.wsHandleSound = function (ws) {

    };

    this.addTransaction = function (transaction) {
        var index = transaction.index;
        var module = transaction.module;
        var description = transaction.description;
        var payload = transaction.payload;
        var createdBy = transaction.createdBy;

        if (index != lastTransactionIndex + 1) return When.reject({reason: 1});

        if (self.privilege[createdBy] != 'all' && self.privilege[createdBy].indexOf(module) == -1)
            return When.reject({reason: 2});

        transaction.createdAt = new Date();

        lastTransactionIndex++;
        for(var client in clients){
            client.send(JSON.stringify({
                type: 'transaction_push',
                index,
                module,
                description,
                createdAt,
                createdBy,
                payload
            }));
        }

        return s.transactionRecord.addTransaction(transaction);
    };

    this.listTransaction = function (startAt, sendNext) {
        return new Promise((resolve, reject)=> {
            var cursor = s.transactionRecord.getTransactionCursor({sessionID: self.sessionID, startAt: startAt});

            function getMore() {
                cursor.next((err, result)=> {
                    if (err) reject(err);
                    if (result) {
                        if(sendNext(result)) getMore();
                    } else {
                        sendNext(null);
                        resolve();
                    }
                });
            }
        });
    };
    this.close = function () {
        var finish = [
            s.transactionRecord.deleteSession({sessionID: self.sessionID}),
            s.transactionRecord.dropTransactionSession({sessionID: self.sessionID}),
            new When.Promise((resolve, reject)=> {
                s.wsHandler.removeRoute("/room/" + self.sessionID);
                resolve();
            })
        ];
        return When.all(finish);
    };
    this.userInSession = function (userID) {
        return userID in self.privilege;
    };
    this.userEditable = function(userID, module){
        return self.privilege[userID].indexOf(module)!=-1;
    }
};