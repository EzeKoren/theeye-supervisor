'use strict';

const config = require('config');
const merge = require('lodash/merge');
var logger = require('../lib/logger')('service:customer');
var Customer = require('../entity/customer').Entity;
var User = require('../entity/user').Entity;
var ResourceMonitor = require('../entity/user').Entity;
var ACL = require('../lib/acl');


module.exports = {
  /**
   * search every user of with this customer
   * and extract its email.
   */
  getAlertEmails (customerName, next) {
    var self = this,
      emails = [];

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

      emails = Array.isArray(customer.emails) ? customer.emails : [];

      User.find({
        'customers._id': customer._id,
        credential: { $ne:['agent'] }
      },(error,users) => {
        if (error) {
          logger.log(error);
          return next(error);
        }

        if (Array.isArray(users) && users.length > 0) {
          users.forEach(user => {
            if (ACL.hasAccessLevel(user.credential,'admin')) {
              if (user.email) {
                emails.push(user.email);
              }
            }
          });
        }

        return next(null, emails);
      });
    });
  },
  /**
   *
   *
   */
  getCustomerConfig (customer,next) {
    if (!next) return;

    var query = (typeof customer == 'string') ? { _id : customer } : customer;

    Customer.findOne(query, function(error,customer){
      if(error){
        logger.error(error);
        return next(error);
      }

      if(!customer){
        logger.error('customer %s not found', customer_id);
        return next(error);
      }

      var basecfg = {
        monitor: config.get('monitor')||{},
        elasticsearch: config.get('elasticsearch')||{enabled:false} // no config available
      };

      // deep replace objects properties
      var ccfg = merge({}, basecfg, (customer.config||{}));

      // extend default config options with customer defined options
      if(next) return next(null,ccfg);
    });
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
    var data = {
      emails: input.emails,
      name: input.name,
      description: (input.description||'')
    };

    var customer = new Customer(data);
    customer.save(function(err, customer){
      if(err) return next(err);
      else return next(null, customer);
    });
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
