'use strict';

const mongoose = require('mongoose')
const ObjectId = mongoose.Schema.Types.ObjectId
const BaseSchema = require('./schema') // template schema

const Schema = new BaseSchema({
  script: { type: ObjectId }, // has one
  script_id: { type: ObjectId }, //has one
  script_arguments: { type: Array },
  script_runas: { type: String, default: '' },
})

module.exports = Schema
