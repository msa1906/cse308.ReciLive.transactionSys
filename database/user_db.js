const When = require('when');
const s = global.s;

var userDB = {};
exports.initDatabase = function (readyList) {
    var userDBPath = s.dbPath + "user";
    var userDBReady = When.defer();
    readyList.push(userDBReady.promise);
    console.log('try to connect to ' + userDBPath);

    s.mongodb.MongoClient.connect(userDBPath, function (err, db) {
        if (err) {
            console.error('MongodbClient connection ' + userDBPath + ' failed');
            process.exit(1);
        } else {
            console.log('MongodbClient connection to ' + userDBPath + ' has been established');
            userDB.usersColl = db.collection('users');
            userDB.usersColl.createIndex({googleID:1});
            userDB.usersColl.createIndex({email:1});
            userDBReady.resolve();
        }
    });
};

//email, role, google id, username
/**
 * get user by its google id
 * @param id
 * @returns {Promise} returns the doc its self, otherwise null
 */
exports.getUserByGoogleID = function (id) {
    return userDB.usersColl.findOne({googleID: id});
};

exports.getUserByEmail = function (email) {
    return userDB.usersColl.findOne({email: id});
};

exports.addUser = function (googleID, email, role, username) {
    return userDB.usersColl.insertOne({
        googleID,
        email,
        role,
        username,
    });
};