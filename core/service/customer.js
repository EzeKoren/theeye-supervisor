'use strict';

const config = require('config')
const merge = require('lodash/merge')
const logger = require('../lib/logger')('service:customer')
const ACL = require('../lib/acl')
const Customer = require('../entity/customer').Entity
const User = require('../entity/user').Entity
const ResourceMonitor = require('../entity/user').Entity

module.exports = {
  /**
   * @summary get the email of every user for this customer
   * @param {String} customerName
   * @param {Function} next
   */
  getAlertEmails (customerName, next) {
    const self = this
    var emails = []

    Customer.findOne({ name: customerName },function(error, customer){
      if (error) {
        logger.log(error);
        return next(error);
      }

      if (!customer) {
        var err = new Error('customer ' + customerName + ' does not exist!');
        logger.error(err);
        return next(err,[]);
      }

      if (customer.owner && customer.owner.email) {
        emails.push(customer.owner.email)
      }

      User.find({
        'customers._id': customer._id,
        credential: { $nin: ['agent','integration'] }
      }, (error, users) => {
        if (error) {
          logger.log(error)
          return next(error)
        }

        if (Array.isArray(users) && users.length > 0) {
          users.forEach(user => {
            if (ACL.hasAccessLevel(user.credential,'admin')) {
              if (user.email) {
                emails.push(user.email);
              }
            }
          })
        }

        return next(null, emails)
      })
    })
  },
  /**
   *
   * @param {Mixed} filters, string or query
   *
   */
  getCustomerConfig (filters, next) {
    if (!next) { return }
    if (!filters) { return }
    const query = (typeof filters === 'string') ? { _id : filters } : filters

    Customer.findOne(query, (error, customer) => {
      if (error) {
        logger.error(error)
        return next(error)
      }

      if (!customer) {
        const err = new Error('customer not found')
        err.filters = filters 
        logger.error('%o',err)
        return next(err)
      }

      const basecfg = {
        monitor: config.monitor || {},
        elasticsearch: config.logger.elasticsearch || {enabled:false} // no config available
      }

      // deep replace objects properties
      var ccfg = merge({}, basecfg, (customer.config || {}))

      // extend default config options with customer defined options
      if (next) { return next(null,ccfg) }
    })
  },
  fetch (filter, next) {
    Customer.find({}, function(err, customers) {
      if(err) return next(err);
      else return next(null, customers);
    });
  },
  /**
   * creates a customer entity
   *
   * @author JuanSan
   * @param {Array} data
   * @param {Function} next
   * @return null
   */
  create (input, next) {
    const data = {
      name: input.name,
      description: (input.description || '')
    }

    if (input.config) {
      const config = input.config
      data.config = {
        elasticsearch: (config.logger.elasticsearch || { enabled: false }),
        kibana: (config.kibana || null)
      }
    }

    var customer = new Customer(data)
    customer.save(function(err, customer){
      if (err) return next(err)
      else return next(null, customer)
    })
  },
  /**
   *
   *
   */
  remove (customer, doneFn) {
    logger.log('removing customer %s from users', customer.name);

    User
      .find({'customers._id': customer._id})
      .exec(function(error,users){
        if (users && users.length > 0) {
          for (var i=0; i<users.length; i++) {
            var user = users[i];

            if (user.credential != 'agent') {
              var customers = user.customers;
              var filteredCustomers = filterCustomer(customer, customers);
              user.customers = filteredCustomers;
              user.save(function (error) {
                if (error) {
                  logger.error(error);
                } else {
                  logger.log('user customers updated');
                }
              });
            } else {
              // is an agent user
              user.remove(function(error){
                if(error) logger.error(error);
                else logger.log('customer %s agent user removed', customer.name);
              });
            }
          }
        }
      });

    customer.remove(function(error){
      if (error) {
        logger(error);
      } else {
        logger.log('customer %s removed', customer.name);
        doneFn(null);
        return;
      }
    });
  }
};

/**
 *
 * remove customer from customers and return resulting array.
 * @author Facundo
 * @param {Object} customer
 * @param {Array} customers
 * @return {Array} result
 *
 */
function filterCustomer (customer,customers) {
  var filtered = [];
  for(var i=0;i<customers.length; i++){
    var item = customers[i];
    if( item._id != customer._id ) {
      filtered.push( item );
    }
  }
  return filtered;
}
