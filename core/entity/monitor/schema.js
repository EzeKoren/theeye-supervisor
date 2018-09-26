const util = require('util')
const Schema = require('mongoose').Schema
const ObjectId = Schema.Types.ObjectId
const debug = require('debug')('eye:entity:monitor')
const lodashAssign = require('lodash/assign')
const lodashAfter = require('lodash/after')

const properties = {
  looptime: { type: Number },
  name: { type: String },
  type: { type: String },
  config: { type: Object, default: {} },
  tags: { type: Array, default: [] },
  customer_id: { type: ObjectId },
  customer_name: { type: String },
  description: { type: String },
  creation_date: { type: Date, default: Date.now },
  last_update: { type: Date, default: Date.now },
  // RELATIONS
  customer: { type: ObjectId, ref: 'Customer' }, // belongs to
}

function BaseSchema (specs, opts) {
  
  // Schema constructor
  Schema.call(this, Object.assign({}, properties, specs), {
    collection: opts.collection,
    discriminatorKey: '_type'
  })

  this.pre('save', function(next) {
    this.last_update = new Date()
    // do stuff
    next()
  })

  // Duplicate the ID field.
  this.virtual('id').get(function () {
    return this._id.toHexString()
  })

  const def = {
    getters: true,
    virtuals: true,
    transform: function (doc, ret, options) {
      // remove the _id of every document before returning the result
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
    }
  }

  this.set('toJSON', def);
  this.set('toObject', def)

  this.methods.publish = function (options, next) {
    var data = this.toObject()
    if (next) { next(null, data) }
    return data
  }

  this.statics.publishAll = function (entities, next) {
    if (!entities || entities.length == 0) {
      return next([])
    }

    var published = []
    var donePublish = lodashAfter(entities.length, function () {
      next(null, published)
    })

    for (let i = 0; i<entities.length; i++){
      var entity = entities[i];
      entity.publish({}, function(error, data) {
        published.push(data);
        donePublish()
      })
    }
  }

  /**
   *
   *
   *
   *
   *
   *
   *    WARNING WARNING
   *
   *   NOTE NOTE NOTE NOTE NOTE NOTE NOTE NOTE NOTE NOTE
   *
   *
   * THIS IS JUST FOR THE UPDATE PART
   * CREATION IS MADE IN THIS FILE
   *
   * resource/monitor.js
   *
   *
   * UGLY SHIT, I KNOW....
   *
   *
   *
   *
   *
   *
   */
  this.methods.setUpdates = function (input, next) {
    next || (next = function(){})
    var monitor = this
    var type = monitor.type
    debug('updating resource monitor type "%s"', type)

    /** set common properties **/
    if (input.looptime) monitor.looptime = input.looptime;
    if (typeof input.enable == 'boolean') monitor.enable = input.enable;
    if (input.host_id) {
      monitor.host = input.host_id;
      monitor.host_id = input.host_id;
    }
    if (input.tags) monitor.tags = input.tags;
    if (input.name) monitor.name = input.name;
    if (typeof input.description === 'string') monitor.description = input.description;

    monitor.template = null
    monitor.template_id = null

    var config = monitor.config || {}
    if (input.config) {
      lodashAssign(input, input.config)
    }

    switch (type) {
      case 'scraper':
        //monitor.host_id = input.external_host_id || input.host_id;
        monitor.host_id = input.host_id;
        config.external = Boolean(input.external_host_id);
        config.url = input.url;
        config.timeout = input.timeout;
        config.method = input.method;
        config.json = (input.json=='true'||input.json===true);
        config.gzip = (input.gzip=='true'||input.gzip===true);
        config.parser = input.parser;
        config.status_code = input.status_code;
        config.body = input.body;

        if(input.parser=='pattern'){
          config.pattern = input.pattern;
          config.script = null;
        } else if(input.parser=='script'){
          config.pattern = null;
          config.script = input.script;
        } else {
          config.pattern = null;
          config.script = null;
        }
        break;
      case 'process':
        config.ps.raw_search = input.raw_search;
        config.ps.is_regexp = Boolean(input.is_regexp=='true' || input.is_regexp===true);
        config.ps.pattern = (!config.ps.is_regexp) ? RegExp.escape(input.raw_search) : input.raw_search;
        config.ps.psargs = input.psargs;
        break;
      case 'file':
        config.is_manual_path = input.is_manual_path
        config.path = input.path
        config.basename = input.basename
        config.dirname = input.dirname
        config.permissions = input.permissions
        config.os_username = input.os_username
        config.os_groupname = input.os_groupname
        config.file = input.file
        break;
      case 'script':
        if (input.script_id) config.script_id = input.script_id;
        if (input.script_arguments) config.script_arguments = input.script_arguments;
        if (input.script_runas) config.script_runas = input.script_runas;
        break;
      case 'dstat':
        if (input.limit) lodashAssign(input, input.limit);
        if (input.cpu) config.limit.cpu = input.cpu;
        if (input.mem) config.limit.mem = input.mem;
        if (input.cache) config.limit.cache = input.cache;
        if (input.disk) config.limit.disk = input.disk;
        break;
      case 'nested':
        config.monitors = input.monitors
      case 'host':
      case 'psaux':
        // no custom configuration
        break;
      default:
        var error = new Error('monitor type "' + type + '" unsupported')
        debug(error.message);
        return next(error);
        break;
    }

    monitor.config = config;
    var updates = {};
    for (var key in monitor.toObject()) {
      if (key != '_id' && key != '__v') {
        updates[key] = monitor[key]
      }
    }

    debug('monitor properties set to %j', updates)

    next(null, updates)
  }
}

util.inherits(BaseSchema, Schema)

module.exports = BaseSchema
