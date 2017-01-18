'use strict';

const mongodb = require('../../lib/mongodb').db;
const FileSchema = require('./schema');

var ScriptSchema = new FileSchema();
ScriptSchema.statics.create = function(data,next) {
  var options = {
    customer_id: data.customer._id,
    customer_name: data.customer.name,
    user_id: data.user._id,
    filename: data.filename,
    keyname: data.keyname,
    mimetype: data.mimetype,
    extension: data.extension,
    size: data.size,
    creation_date: new Date(),
    last_update: new Date(),
    description: (data.description||data.filename),
    md5: data.md5,
    public: data.public
  };

  var script = new Script(options);
  script.save(function(error){
    next(error,script);
  });
}

var File = mongodb.model('File', new FileSchema());
var Script = File.discriminator('Script', ScriptSchema);

File.ensureIndexes();

exports.File = File;
exports.Script = Script;
