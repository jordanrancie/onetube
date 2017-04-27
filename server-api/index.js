var Server  = require('bittorrent-tracker').Server

var server = new Server({
	interval: 30000,
	udp: true, // enable udp server? [default=true]
	http: true, // enable http server? [default=true]
	ws: true, // enable websocket server? [default=true]
	stats: true, // enable web-based statistics? [default=true]
	trustProxy: true
})

// Internal http, udp, and websocket servers exposed as public properties.
server.http
server.udp
server.ws
server.torrents = {}
server.sessions = {}

server.on('error', function (err) {
	// fatal server error!
	console.log(err.message)
})

server.on('warning', function (err) {
	// client sent bad data. probably not a problem, just a buggy client.
	console.log(err.message)
})

server.on('listening', function () {
	// fired when all requested servers are listening
	console.log('now listening on http port:' + server.http.address().port)
	console.log('now listening on udp port:' + server.udp.address().port)
	console.log('now listening on wss port:' + server.ws.address().port)
})

// start tracker server listening! Use 0 to listen on a random free port.

server.listen(9101)
/*
server.listen(9101, 'localhost', function () {

		var httpAddr = server.http.address()
		var httpHost = httpAddr.address !== '::' ? httpAddr.address : 'localhost'
		var httpPort = httpAddr.port
		console.log('HTTP tracker: http://' + httpHost + ':' + httpPort + '/announce')

		var udpAddr = server.udp.address()
		var udpHost = udpAddr.address
		var udpPort = udpAddr.port
		console.log('UDP tracker: udp://' + udpHost + ':' + udpPort)

		var udp6Addr = server.udp6.address()
		var udp6Host = udp6Addr.address !== '::' ? udp6Addr.address : 'localhost'
		var udp6Port = udp6Addr.port
		console.log('UDP6 tracker: udp://' + udp6Host + ':' + udp6Port)

		var wsAddr = server.http.address()
		var wsHost = wsAddr.address !== '::' ? wsAddr.address : 'localhost'
		var wsPort = wsAddr.port
		console.log('WebSocket tracker: ws://' + wsHost + ':' + wsPort)

		var statsAddr = server.http.address()
		var statsHost = statsAddr.address !== '::' ? statsAddr.address : 'localhost'
		var statsPort = statsAddr.port
		console.log('Tracker stats: http://' + statsHost + ':' + statsPort + '/stats')

})
*/

server.http.on('request', function (req, res) {
	if (req.method === 'POST' && req.url.indexOf('/startsession') >= 0) {
		res.setHeader('Access-Control-Allow-Origin', '*')
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
		var body = '';
		req.on('data', function(chunk) {
			body += chunk
		}).on('end', function() {

			var json = JSON.parse(body)

			server.sessions[json.id] = json
			res.statusCode = 200
			console.log('Registering session ' + json.id)
			res.end()
		})
	} else if (req.method === 'GET' && req.url.indexOf('/endsession/') >= 0) {
		res.setHeader('Access-Control-Allow-Origin', '*')
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

		var id = req.url.slice(12)

		if (server.sessions[id]) {
			res.statusCode = 200
			console.log('Destroying session ' + id)
			delete server.sessions[id]
		} else {
			console.log('Invalid request from ' + req.address)
			res.statusCode = 404
		}
		res.end()

	} else if (req.method === 'GET' && req.url.indexOf('/sessions') >= 0) {
		res.setHeader('Access-Control-Allow-Origin', '*')
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
		var infoHashes = Object.keys(server.sessions)
		var anArray = {}
		infoHashes.forEach(function (current) {
			anArray[current] = server.sessions[current]
		})

		res.write(JSON.stringify(anArray))
		res.end()

	}
})

// listen for individual tracker messages from peers:

server.on('start', function (addr) {
	console.log('got start message from ' + addr)
})
server.on('complete', function (addr) {
	console.log('got complete message from ' + addr)
})
server.on('update', function (addr) {
	console.log('got update message from ' + addr)
})
server.on('stop', function (addr) {
	console.log('got stop message from ' + addr)
})