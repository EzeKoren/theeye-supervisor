/**
 * replace here the default configuration values for your
 * local development environment
 */
var join = require('path').join;
module.exports = {
  "system": {
    "base_url": "http://127.0.0.1:60080",
    "web_url": "http://127.0.0.1:6080",
    "file_upload_folder" : join(__dirname , '..', 'uploads')
  },
  "monitor": {
    "disabled": false, // this is enabled if not specified or by default
    "fails_count_alert": 1
  },
  "mongo": {
    "debug":false,
    "user": "",
    "password": "",
    "hosts": "127.0.0.1:27017",
    "database": "theeye"
  },
  logger: {
    dump: {
      enabled: false,
      filename: '/tmp/logger.log'
    }
  },
  "mailer": {
    "from": "The Eye Development %customer% <%customer%@theeye.io>",
    "reply_to": "Support <support@theeye.io>",
    "only_support": false,
    "include_support_bcc": false,
    "support": [ "facugon@theeye.io" ],
    "transport": {
      //"type": "ses",
      "type": "sendmail",
      "options": {
      }
    }
  },
  "notifications": {
    "api": {
      "secret": '77E0EAF3B83DD7A7A4004602626446EADED31BF794956FC9BBAD051FA5A25038',
      "url": "http://127.0.0.1:6080/notification" // the same web server
    }
  },
  "storage": {
    "driver": "local"
  },
  "integrations": {
    "aws": {
      "enabled": false,
      "config": {
        //"username": "",
        //"accessKeyId": "",
        //"secretAccessKey": "",
        //"region": ""
      },
      "s3": {
        "bucket":"theeye.dev"
      }
    }
  }
}
