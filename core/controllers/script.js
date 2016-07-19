var path = require('path');
var mime = require('mime');
var fs = require('fs');
var json = require('../lib/jsonresponse');
var debug = require('../lib/logger')('eye:supervisor:controller:script');
var resolve = require('../router/param-resolver');
var validate = require('../router/param-validator');
var filter = require('../router/param-filter');

var ScriptService = require('../service/script');
var ResourceService = require('../service/resource');
var Script = require('../entity/script').Entity;
var Job = require('../entity/job').Entity;

module.exports = function(server, passport) {
  server.get('/:customer/script', [
    passport.authenticate('bearer', {session:false}),
    resolve.customerNameToEntity({})
  ], controller.fetch);

  server.post('/:customer/script', [
    passport.authenticate('bearer', {session:false}),
    resolve.customerNameToEntity({})
  ], controller.create);

  server.get('/:customer/script/:script', [
    resolve.customerNameToEntity({}),
    passport.authenticate('bearer', {session:false}),
    resolve.idToEntity({param:'script'}),
  ], controller.get);

  server.patch('/:customer/script/:script', [
    resolve.customerNameToEntity({}),
    passport.authenticate('bearer', {session:false}),
    resolve.idToEntity({param:'script'}),
  ], controller.patch);

  server.del('/:customer/script/:script', [
    resolve.customerNameToEntity({}),
    passport.authenticate('bearer', {session:false}),
    resolve.idToEntity({param:'script'}),
  ], controller.remove);

  server.post('/:customer/script/:script/run', [
    passport.authenticate('bearer', {session:false}),
    resolve.idToEntity({param:'script'}),
    resolve.idToEntity({param:'host'}),
    filter.spawn({param:'script_arguments', filter:'toArray'})
  ], controller.run);
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

    ScriptService.create({
      customer: customer,
      user: user,
      description: description,
      name: name,
      public: req.body.public || false,
      script: script,
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

    ScriptService.remove({
      script: script,
      user: req.user,
      customer: req.customer
    },function(error,data){
      if(error) {
        debug.error(error);
        return res.send(500);
      }

      ResourceService.onScriptRemoved(script);
      res.send(204);
    });
  },
  /**
   *
   *
   */
  patch: function(req, res, next) {
    var script = req.script;
    var file = req.files.script;
    var description = req.body.description;
    var name = req.body.name;

    if(!script) return res.send(404,json.error('script not found'));
    if(!file && !description && !name)
      return res.send(400, json.error('nothing to update'));

    ScriptService.update({
      customer: req.customer,
      user: req.user,
      script: script,
      description: description,
      name: name,
      public: req.body.public||false,
      file: file
    },function(error, script){
      if(error) return res.send(500);

      ResourceService.onScriptUpdated(script);

      script.publish(function(error, data){
        res.send(200,{ 'script': data });
      });
    });
  },
  /**
   * run a marco
   * @method POST
   * @param Script script id
   * @param Host host id
   * @param Array script arguments
   */
  run : function(req, res, next) {
    debug.log('processing "run macro" request');

    var script = req.script;
    var host = req.host;
    var user = req.user;
    var args = req.script_arguments;

    var errors = [];
    if(!script) errors.push({'param':'script','message':'required'});
    if(!host) errors.push({'param':'host','message':'required'});
    if(!user) errors.push({'param':'user','message':'required'});

    if(errors.length != 0) return res.send(400, {"errors":errors, "req":req.params});

    Job.createMacro({
      host: host,
      "script_id": script._id,
      "script_arguments": args,
      user: user,
      notify: true
    },function(job) {
      job.publish(function(pub){
        res.send(200,{ job : pub });
      });
    });
  }
};
