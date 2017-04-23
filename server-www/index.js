var compress = require('compression')
var cors = require('cors')
var debug = require('debug')('instant')
var downgrade = require('downgrade')
var express = require('express')
var fs = require('fs')
var http = require('http')
var https = require('https')
var pug = require('pug')
var parallel = require('run-parallel')
var path = require('path')
var twilio = require('twilio')
var unlimited = require('unlimited')
var url = require('url')
var ExpressPeerServer = require('peer').ExpressPeerServer;


var config = require('../config')

var CORS_WHITELIST = [
  // Official WebTorrent site
  'http://webtorrent.io',
  'https://webtorrent.io'
]

var secret, secretKey, secretCert
try {
  secret = require('../secret')
  secretKey = fs.readFileSync(path.join(__dirname, '../secret/instant.io.key'))
  secretCert = fs.readFileSync(path.join(__dirname, '../secret/instant.io.chained.crt'))
} catch (err) {}

var app = express()
var httpServer = http.createServer(app)
var httpsServer
if (secretKey && secretCert) {
  httpsServer = https.createServer({ key: secretKey, cert: secretCert }, app)
}

unlimited()

// PeerJS Connection Broker
app.use('/peerjs', ExpressPeerServer(httpServer, {debug: true, allow_discovery: true}));

app.on('connection',
  function(id) {
    console.log('Received \'connection\' from : ' + id)
  });
app.on('disconnect',
  function(id) {
	  console.log('Received \'disconnect\' from : ' + id)
  });

// Templating
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'pug')
app.set('x-powered-by', false)
app.engine('pug', pug.renderFile)

app.use(compress())

app.use(function (req, res, next) {
  // Force SSL
  if (config.isProd && req.protocol !== 'https') {
    return res.redirect('https://' + (req.hostname || 'instant.io') + req.url)
  }

  // Redirect www to non-www
  if (config.isProd && req.hostname === 'www.instant.io') {
    return res.redirect('https://instant.io' + req.url)
  }

  // Use HTTP Strict Transport Security
  // Lasts 1 year, incl. subdomains, allow browser preload list
  if (config.isProd) {
    res.header(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    )
  }

  // Add cross-domain header for fonts, required by spec, Firefox, and IE.
  var extname = path.extname(url.parse(req.url).pathname)
  if (['.eot', '.ttf', '.otf', '.woff', '.woff2'].indexOf(extname) >= 0) {
    res.header('Access-Control-Allow-Origin', '*')
  }

  // Prevents IE and Chrome from MIME-sniffing a response. Reduces exposure to
  // drive-by download attacks on sites serving user uploaded content.
  res.header('X-Content-Type-Options', 'nosniff')

  // Prevent rendering of site within a frame.
  res.header('X-Frame-Options', 'DENY')

  // Enable the XSS filter built into most recent web browsers. It's usually
  // enabled by default anyway, so role of this headers is to re-enable for this
  // particular website if it was disabled by the user.
  res.header('X-XSS-Protection', '1; mode=block')

  // Force IE to use latest rendering engine or Chrome Frame
  res.header('X-UA-Compatible', 'IE=Edge,chrome=1')

  next()
})

app.use(express.static(path.join(__dirname, '../static')))

app.get('/', function (req, res) {
  res.render('index', {
    title: 'opentube.io - Synchronously sharing media over WebTorrent'
  })
})

// Fetch new ice_servers from twilio token regularly
var iceServers
var twilioClient
try {
  twilioClient = twilio(secret.twilio.accountSid, secret.twilio.authToken)
} catch (err) {}

function updateIceServers () {
  twilioClient.tokens.create({}, function (err, token) {
    if (err) return error(err)
    if (!token.ice_servers) {
      return error(new Error('twilio response ' + token + ' missing ice_servers'))
    }

    iceServers = token.ice_servers
      .filter(function (server) {
        var urls = server.urls || server.url
        return urls && !/^stun:/.test(urls)
      })
    iceServers.unshift({ url: 'stun:23.21.150.121' })

    // Support new spec (`RTCIceServer.url` was renamed to `RTCIceServer.urls`)
    iceServers = iceServers.map(function (server) {
      if (server.urls === undefined) server.urls = server.url
      return server
    })
  })
}

if (twilioClient) {
  setInterval(updateIceServers, 60 * 60 * 4 * 1000).unref()
  updateIceServers()
}

// WARNING: This is *NOT* a public endpoint. Do not depend on it in your app.
app.get('/_rtcConfig', cors({
  origin: function (origin, cb) {
    var allowed = CORS_WHITELIST.indexOf(origin) >= 0 ||
      /https?:\/\/localhost(:|$)/.test(origin) ||
      /https?:\/\/[^./]+\.localtunnel\.me$/.test(origin)
    cb(null, allowed)
  }
}), function (req, res) {
  if (!iceServers) res.status(404).send({ iceServers: [] })
  else res.send({ iceServers: iceServers })
})

app.get('*', function (req, res) {
  res.status(404).render('error', {
    title: '404 Page Not Found - Instant.io',
    message: '404 Not Found'
  })
})

// error handling middleware
app.use(function (err, req, res, next) {
  error(err)
  res.status(500).render('error', {
    title: '500 Internal Server Error - Instant.io',
    message: err.message || err
  })
})

var tasks = [
  function (cb) {
    httpServer.listen(config.ports.http, config.host, cb)
  }
]

if (httpsServer) {
  tasks.push(function (cb) {
    httpsServer.listen(config.ports.https, config.host, cb)
  })
}

parallel(tasks, function (err) {
  if (err) throw err
  debug('listening on port %s', JSON.stringify(config.ports))
  downgrade()
})

function error (err) {
  console.error(err.stack || err.message || err)
}
