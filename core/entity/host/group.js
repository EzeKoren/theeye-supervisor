"use strict"

const mongodb = require('../../lib/mongodb')
const Schema = require('mongoose').Schema
const ObjectId = Schema.Types.ObjectId
const debug = require('debug')('eye:entity:host:group')
const BaseSchema = require('../base-schema')

const TriggerTemplate = new Schema({
  emitter_template_id: { type: Schema.Types.ObjectId },
  emitter_template_type: { type: 'String' },
  task_template_id: { type: Schema.Types.ObjectId },
  event_type: { type: String },
  event_name: { type: String },
  task_template: { type: Schema.Types.ObjectId, ref: 'TaskTemplate' },
})

const properties = {
  hostname_regex: { type: String },
  name: { type: String },
  description: { type: String },
  enable: { type: Boolean, default: true },
  customer_id: { type: ObjectId, required: true, index: true },
  customer_name: { type: String },
  customer: { type: ObjectId, ref: 'Customer' }, // belongs to
  hosts: [{ type: ObjectId, ref: 'Host' }], // has many
  tasks: [{ type: ObjectId, ref: 'TaskTemplate' }], // has many
  resources: [{ type: ObjectId, ref: 'ResourceTemplate' }], // has many
  triggers: [ TriggerTemplate ], // has many
}

exports.properties = properties

var EntitySchema = new BaseSchema(properties,{
  collection: 'host_templates',
  discriminatorKey: '_type'
})

EntitySchema.methods.populateAll = function(next) {
  Entity.populate(this,[
    { path: 'customer' },
    { path: 'hosts' },
    { path: 'tasks' },
    { path: 'resources' },
    {
      path: 'triggers',
      populate: {
        path: 'task_template',
        select: 'name type' // only populate this fields
      }
    },
  ],next)
}

var Entity = mongodb.db.model('HostGroup', EntitySchema)
Entity.ensureIndexes();

exports.EntitySchema = EntitySchema;
exports.Entity = Entity;
