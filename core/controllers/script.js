var path = require('path');
var mime = require('mime');
var fs = require('fs');
var json = require('../lib/jsonresponse');
var debug = require('../lib/logger')('eye:supervisor:controller:script');
var ScriptService = require('../service/script');
var MonitorService = require('../service/resource/monitor');

var Script = require('../entity/script').Entity;

var resolve = require('../router/param-resolver');
var validate = require('../router/param-validator');

module.exports = function(server, passport) {
  server.get('/script', [ 
    passport.authenticate('bearer', {session:false}),
    resolve.customerNameToEntity({})
  ], controller.fetch);

  server.post('/script', [
    passport.authenticate('bearer', {session:false}),
    resolve.customerNameToEntity({})
  ], controller.create);

  server.get('/script/:script', [
    passport.authenticate('bearer', {session:false}),
    resolve.idToEntity({param:'script'}),
  ], controller.get);

  server.patch('/script/:script', [
    passport.authenticate('bearer', {session:false}),
    resolve.idToEntity({param:'script'}),
  ], controller.patch);

  server.del('/script/:script', [
    passport.authenticate('bearer', {session:false}),
    resolve.idToEntity({param:'script'}),
  ], controller.remove);
}

var controller = {
  /**
   *
   *
   */
  fetch : function (req, res, next) {
    var user = req.user ;
    var customer = req.customer;

    if(!customer) return res.send(400, json.error('customer is required'));
    if(!user) return res.send(400,json.error('invalid user'));

    ScriptService.fetchBy({
      customer_name: customer.name,
      //user_id : user._id
    }, function(scripts){
      if (!scripts) scripts = [];
      res.send(200, { scripts : scripts });
    });

    next();
  },
  /**
   *
   *
   */
  get : function (req, res, next) {
    var script = req.script;
    var customer = req.customer;

    if(!script) return res.send(404, json.error('not found'));

    script.publish(function(error, data){
      res.send(200, { 'script' : data });
    });
    next();
  },
  /**
   *
   *
   */
  create : function (req, res, next) {
    var user = req.user;
    var customer = req.customer;

    var script = req.files.script;
    if(!user) return res.send(400,json.error('invalid user'));
    if(!script) return res.send(400,json.error('invalid script', script));
    if(!validate.isRecomendedFilename(script.name))
      return res.send(400,json.error('invalid filename', script.name));

    var description = req.body.description;
    var name = req.body.name;

    debug.log('creating script');

    ScriptService.handleUploadedScript({
      description: description,
      name: name,
      script: script,
      customer: customer,
      user: user
    },function(error,script){
      if(error) {
        debug.error(error);
        res.send(500, json.error('internal server error',{
          error: error.message
        }) );
      } else {
        script.publish(function(error, data){
          res.send( 200, { 'script': data });
        });
      }
    });
    next();
  },
  /**
   *
   *
   */
  remove : function (req, res, next) {
    var script = req.script;

    if(!script) return res.send(404,json.error('script not found'));

    ScriptService.remove(script, function(error,data){
      if(error) {
        debug.error(error);
        return res.send(500);
      }

      MonitorService.disableScriptMonitorsWithDeletedScript(script);

      res.send(204);
    });
  },
  /**
   *
   *
   */
  patch : function(req, res, next) {
    var script = req.script;
    var file = req.files.script;
    var description = req.body.description;
    var name = req.body.name;

    if(!script) return res.send(404,json.error('script not found'));
    if(!file && !description && !name)
      return res.send(400, json.error('nothing to update'));

    ScriptService.handleUpdateUploadedScript({
      'script' : script,
      'description' : description,
      'name' : name,
      'file' : file
    },function(error, script){
      if(error) return res.send(500);

      MonitorService.notifyScriptMonitorsUpdate(script);

      script.publish(function(error, data){
        res.send(200,{ 'script': data });
      });
    });
  }
};
