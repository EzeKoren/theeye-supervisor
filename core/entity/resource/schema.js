var Schema = require('mongoose').Schema;

var DEFAULT_TYPE = 'unknown' ;

var properties = exports.properties = {
  'customer_id' : { type:String, required:true },
  'customer_name' : { type:String, required:true },
  'description' : { type:String, required:true },
  'name' : { type:String, required:true },
  'user_id' : { type: String, 'default': null },
  'type' : { type:String, 'default':DEFAULT_TYPE },
  'attend_failure' : { type:Boolean, 'default':false },
  'failure_severity' : { type:String, 'default':null },
  'alerts': {type:Boolean, 'default':true}
};

/**
 *
 * Schema Definition 
 * 
 **/
var EntitySchema = Schema(properties,{ discriminatorKey : '_type' });
exports.EntitySchema = EntitySchema;

EntitySchema.statics.DEFAULT_TYPE = DEFAULT_TYPE ;

EntitySchema.methods.publish = function(next)
{
  var resource = this;
  var data = {
    'id': resource._id,
    'name': resource.name,
    'description': resource.description,
    'type': resource.type,
    'alerts': resource.alerts
  };
  next ? next(null,data) : null;
  return data;
}
