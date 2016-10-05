"use strict";

var extend = require('util')._extend;

module.exports = function(input, defaults){

  var filter = {};
  defaults||(defaults={});

  filter.where = extend( (defaults.where||{}), (input.where||{}) );

  filter.limit = parseInt(input.limit)||null;

  filter.sort = extend( (defaults.sort||{}), (input.sort||null) );

  return filter ;

}
