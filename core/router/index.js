var logger = require('../lib/logger')('eye:supervisor:router');
var config = require('config');
var fs = require("fs");
var join = require("path").join;

var Router = module.exports = {};

Router.resolve = require('./param-resolver');

Router.filter = require('./param-filter');

Router.validate = require('./param-validator');

Router.loadControllers = function(server, passport)
{
  logger.log('loading %s controllers', server.name);
  var controllersPath = join(__dirname, "../controllers");

  fs.readdirSync(controllersPath).forEach(function(file) {
    if( /.*\.js$/.test(file) )
    {
      require( join(controllersPath, file) )(server, passport);
      logger.log('controller set "%s"', file);
    }
  });
};
