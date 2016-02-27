var moment = require('moment');
var crypto = require("crypto"); 

exports.create = function(client_id, client_secret, next) {
  var timestamp = moment().format('YYYY-MM-DD HH:00:00');
  var key = client_id + client_secret + timestamp
  var token = crypto.createHmac("sha1", key)
    .update(client_secret)
    .digest("hex"); 

  if(!token) next(new Error("Can't create token"));
  else next(null, {'token': token , 'timestamp': timestamp});
}
