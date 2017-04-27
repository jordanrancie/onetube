module.exports = Player
module.exports = Session

var createTorrent = require('create-torrent')
var debug = require('debug')('onetube.io')
var dragDrop = require('drag-drop')
var moment = require('moment')
var EventEmitter = require('events').EventEmitter
var inherits = require('inherits')
var path = require('path')
var prettierBytes = require('prettier-bytes')
var throttle = require('throttleit')
var thunky = require('thunky')
var uploadElement = require('upload-element')
var WebTorrent = require('webtorrent')
var xhr = require('xhr')
var get = require('simple-get')
var Graph = require('p2p-graph')
var util = require('./util')
var Sortable = require('sortablejs')
var Peer = require('peerjs')
var DataConnection = require('../node_modules/peerjs/lib/dataconnection')
var Torrent = require('../node_modules/webtorrent/lib/torrent')
var render = require('render-media')
var MediaElementWrapper = require('mediasource')
var URL = window.URL || window.webkitURL

inherits(Player, EventEmitter)
inherits(Session, EventEmitter)


var VIDEO = [
	'.m4a',
	'.m4v',
	'.mp4',
	'.mkv',
	'.webm'
]

var AUDIO = [
	'.mp3',
	'.aac',
	'.oga',
	'.ogg',
	'.wav'
]

var IMAGE = [
	'.bmp',
	'.gif',
	'.jpeg',
	'.jpg',
	'.png'
]


var sessionServer = "onetube.io"
var sessionServerPort = "9101"
// Redefine the AnnounceLIst to use only our server
createTorrent.announceList = [
	//[ 'udp://tracker.openbittorrent.com:80' ],
	//[ 'udp://tracker.internetwarriors.net:1337' ],
	//[ 'udp://tracker.leechers-paradise.org:6969' ],
	//[ 'udp://tracker.coppersurfer.tk:6969' ],
	//[ 'udp://exodus.desync.com:6969' ],
	//[ 'wss://tracker.btorrent.xyz' ],
	//[ 'wss://tracker.openwebtorrent.com' ],
	//[ 'wss://tracker.fastcast.nz' ]
	[ 'ws://' + sessionServer + ':' + sessionServerPort ]
]

//localStorage.debug = 'render-media'
var torrentClient = {}
var player = {}

var playlists = {}
var activePlaylist = {}

var torrents = {}
var files = {}

var sessions = {}
var session = {}

var peerId = ''
var screenName = ''
var sessionImmutableOps = {}
var graph = null

// UI Elements
var sessionsTable = document.querySelector('#sessionsList tbody')
var sessionPlayerPlaylist = document.getElementById('sessionPlaylistBox')
var sessionPeersTable = document.getElementById('users')
var playerDiv = document.getElementById('sessionPlayer')
var controls = document.getElementById('controls')
var playlistTabs = document.getElementById('playlisttabs')
var playlistSection = document.getElementById('playlist')
var playerSongTitle = document.querySelector('h3.nowPlaying')
var messages = document.getElementById('messages')

var upNext = document.getElementById('upNextPlayingBox')
var nowPlaying = document.getElementById('nowPlayingItem')
var newPlaylistAction = document.getElementById('newPlaylist')


global.WEBTORRENT_ANNOUNCE = createTorrent.announceList
	.map(function (arr) {
		return arr[0]
	})
	.filter(function (url) {
		return url.indexOf('wss://') === 0 || url.indexOf('ws://') === 0
	})

var getClient = thunky(function (cb) {
	getRtcConfig(function (err, rtcConfig) {
		if (err) util.error(err)

		var opts = {
			tracker: {
				rtcConfig: rtcConfig
			}
		}

		//if (peerId !== '')
		//	opts.peerId = peerId

		torrentClient = new WebTorrent(opts)
		torrentClient.on('ready', onReady)
		torrentClient.on('warning', onWarning)
		torrentClient.on('error', onError)

		logAllEmitterEvents(torrentClient)

		cb(null, torrentClient)
	})
})

// APP Init function

// TODO - Sessions working
// TODO - Session Updates propogated to API Server by lastUpdated
// TODO - Session Player commands
// TODO - code on bitbucket
// TODO - Code for production environment
// TODO - Platform launched to public server

//// TODO PRO VERSION
// TODO - handle both private and public session use cases - also updated Sessions
// TODO - Youtube, soundclound, spotify
// TODO - Drive, Dropbox and OneDrive
// TODO - Facebook, Google and Twitter integration
// TODO - Share with friends
// TODO - QR Scan and 'load by link'
// TODO - Save playlist
// TODO - Save file
// TODO - Sell file(s) - ownership transfer / buy a copy


init()

function init () {
	if (!WebTorrent.WEBRTC_SUPPORT) {
		util.error('This browser is unsupported. Please use a browser with WebRTC support.')
	}

	ReadCookie()

	if (screenName === '') {
		document.querySelector('#preview').classList.remove("hidden")
		//document.querySelector('#playlist').classList.add("hidden")
		document.querySelector('#sessionsSection').classList.add("hidden")

		var tmp = document.querySelector('form#peerId button[name=nameSubmit')
		tmp.addEventListener('click', function (e) {
			e.preventDefault()
			document.cookie = "screenName=" + document.querySelector('form#peerId input[name=peerName').value.trim()
			init()
		})

		return
	} else {
		document.querySelector('#preview').classList.add("hidden")
		//document.querySelector('#playlist').classList.remove("hidden")
		document.querySelector('#sessionsSection').classList.remove("hidden")
	}

	// And now we start..........

	// For performance, create the client immediately
	getClient(function () {})

	var plId = newPlaylist('My Playlist', true)
	activePlaylist = playlists[plId]

	// Seed via upload input element
	var upload = document.querySelector('input[name=upload]')
	uploadElement(upload, function (err, files) {
	if (err) return util.error(err)
		files = files.map(function (file) { return file.file })
		addPlaylistFiles(files)
		upload.value = upload.defaultValue
	})

	Sortable.create(playlistTabs)

	// Seed via drag-and-drop
	dragDrop('#playlistSection', addPlaylistFiles)

	var bb = document.querySelector('button[name=sessionSubmit]')
	bb.addEventListener('click', function (e) {
		e.preventDefault()
		if (!(session instanceof Session)) { newSession() }
		else { endSession() }
	})
	document.querySelector('form#joinsession button[name=joinSubmit').addEventListener('click', function (e) {
		e.preventDefault()
		joinSession(document.querySelector('form#joinsession input[name=sessionId]').value.trim())
	})
	document.querySelector('form#joinsession button[name=scanSubmit').addEventListener('click', function (e) {
		e.preventDefault()
		qrScanSession()
	})
	document.querySelector('form#messageBarForm button[name=messageSubmit').addEventListener('click', function (e) {
		e.preventDefault()
		var el = document.querySelector('form#messageBarForm input[name=messageBarInput]')
		sendMessage(el.value)
		el.value = upload.defaultValue
	})
	newPlaylistAction.addEventListener('click', function (e) {
		e.preventDefault()
		newPlaylist()
	})


	// In the event you are working on a local playlist
	window.addEventListener('playlistItemAdded', _onPlaylistItemAdded)
	window.addEventListener('playlistUpdated', _onPlaylistUpdated)
	window.addEventListener('playlistItemTorrentLoading', _onPlaylistItemTorrentLoading)
	window.addEventListener('playlistItemTorrentSeeding', _onPlaylistItemTorrentSeeding)
	window.addEventListener('playlistItemRemoved', _onPlaylistItemRemoved)

	//window.addEventListener('playlistUpdate', _onPlaylistUpdate)
	scanOpenSessions()
	setInterval(scanOpenSessions, 10000)

}

function ReadCookie() {

	var cookies = document.cookie.split(';')

	for(var i = 0; i < cookies.length; i++){
		var pair = cookies[i].split('=')
		if (pair.length === 2) {
			var name = cookies[i].split('=')[0].trim()
			var value = cookies[i].split('=')[1].trim()
			if (name === 'peerId')
				peerId = value
			else if (name === 'screenName')
				screenName = value
		}
	}

}

function logAllEmitterEvents(eventEmitter) {

	var emitToLog = eventEmitter.emit
	var exclusions = ['invalidPeer', 'trackerAnnounce']

	eventEmitter.emit = function () {
		var event = arguments[0]
		if (!exclusions.includes(event))
			util.log('event emitted: \'<strong>' + event +'\'</strong> for  \'' + eventEmitter.constructor.name + '\'')
		emitToLog.apply(eventEmitter, arguments)
	}
}

function getRtcConfig (cb) {
	// WARNING: This is *NOT* a public endpoint. Do not depend on it in your app.
	xhr('/_rtcConfig', function (err, res) {
		if (err || res.statusCode !== 200) {
			cb(new Error('Could not get WebRTC config from server. Using default (without TURN).'))
		} else {
			var rtcConfig
			try {
				rtcConfig = JSON.parse(res.body)
			} catch (err) {
				return cb(new Error('Got invalid WebRTC config from server: ' + res.body))
			}
			debug('got rtc config: %o', rtcConfig)
			cb(null, rtcConfig)
		}
	})
}


// WebTorrent event related functions

function onReady() {
	peerId = torrentClient.peerId
	document.cookie = 'peerId=' + peerId
	//document.getElementById('idinfo').innerHTML = '[INFO: You are ' + screenName + ', ' + peerId +']'
	sessionImmutableOps = {client: torrentClient}
}

function onWarning (err) { util.warning(err) }

function onError (err) { util.error(err) }


// Session related functions

function newSession () {

	// In case already in another session
	if (session instanceof Session)
		session.endSession()

	//var torrentFiles = Object.keys(myPlaylist).map(function(k){return myPlaylist[k]})
	//var v1 = document.querySelector('form#newsession input[name=sessionName]')
	//var v2 = document.querySelector('form#newsession input[name=sessionEditable]')
	//var v3 = document.querySelector('form#newsession input[name=sessionPublic]')

	session = new Session(
		Object.assign({
			owner : peerId,
			ownerAlias: screenName,
			player: player
		}, sessionImmutableOps)
	)

	// Session Event Listeners for 'Open'
	session.on('start', _onSessionStart)
	session.on('registered', _onSessionRegistered)

	// Session Event Listeners for 'Close'
	session.on('deregistered', _onSessionDeregistered)
	session.on('end', _onSessionEnd)
	session.on('joined', _onSessionJoined)
	session.on('addPeer', _onPeerJoined)
	session.on('removePeer', _onPeerLeft)
	session.on('message', _onMessage)
	session.on('command', _onCommand)
	session.on('playlistItemAdded', _onPlaylistItemAdded)
	session.on('playlistUpdated', _onPlaylistUpdated)
	session.on('playlistItemRemoved', _onPlaylistItemRemoved)
	session.on('playlistItemTorrentLoading', _onPlaylistItemTorrentLoading)
	session.on('playlistItemTorrentSeeding', _onPlaylistItemTorrentSeeding)

	// Start Session
	session.startSession()
}

function endSession() {
	if (session instanceof Session) {
		session.endSession()
	}
}

function joinSession(key) {
	if (sessions[key] !== null) {
		var session = sessions[key].session
		session.on('joined', _onSessionJoined)
		session.on('end', _onSessionEnd)
		session.on('addPeer', _onPeerJoined)
		session.on('removePeer', _onPeerLeft)
		session.on('message', _onMessage)
		session.on('command', _onCommand)
		session.on('playlistItemAdded', _onPlaylistItemAdded)
		session.on('playlistUpdated', _onPlaylistUpdated)
		session.on('playlistItemRemoved', _onPlaylistItemRemoved)
		session.on('playlistItemTorrentLoading', _onPlaylistItemTorrentLoading)
		session.on('playlistItemTorrentSeeding', _onPlaylistItemTorrentSeeding)

		session.joinSession(player)

	} else {
		joinPrivateSession(key)
	}
}

function joinPrivateSession (key) {
	util.warning('TODO This feature has not been implemented yet - nned to fetch session direct from SK')
}

function sendMessage(message) {
	if (session instanceof Session && message !== null && message !== '') {
		session.sendMessage('all', message)
	} else {
		util.warning('No active session. Message dropped.')
	}
}


// Session/Player Event functions

function _onSessionStart(newSession) {
	util.userCommand('\'' + newSession.name + '\' session has started.')
	session = newSession
	loadGraph(true)
}

function _onSessionRegistered(session) {
	util.log('Session "' + session.name + '" registered online.')
}

function _onSessionDeregistered(session) {
	util.log('Session "' + session.name + '" deregistered.')
}

function _onSessionJoined(newSession) {
	util.userCommand('You have joined \'' + newSession.name + '\' session.')

	session = newSession
	sessions[newSession.id] = {session : newSession, update: true}

	updateSessionForm()
	updateSessionsTable()
	//playerControls(session)

}

function _onSessionEnd() {
	var self = this
	util.userCommand('Session "' + session.name + '" closed.')
	var id = ''
	if (session instanceof Session) {
		id = session.id
		session = {}
		updateSessionForm()
		loadGraph(false)
		sessionPeersTable.innerHTML = ''
	}

	if (sessions[id]) {
		sessions[id].update = true

		if (sessions[id].session.isKing()) {
			sessions[id].delete = true
		}
		updateSessionsTable()
	}

	if (self.isKing()) {
		self.removeListener('start', _onSessionStart)
		self.removeListener('registered', _onSessionRegistered)
		self.removeListener('deregistered', _onSessionDeregistered)
	}

	self.removeListener('message', _onMessage)
	self.removeListener('command', _onCommand)
	self.removeListener('joined', _onSessionJoined)
	self.removeListener('end', _onSessionEnd)
	self.removeListener('addPeer', _onPeerJoined)
	self.removeListener('removePeer', _onPeerLeft)
	self.removeListener('playlistItemAdded', _onPlaylistItemAdded)
	self.removeListener('playlistUpdated', _onPlaylistUpdated)
	self.removeListener('playlistItemRemoved', _onPlaylistItemRemoved)
	self.removeListener('playlistItemTorrentLoading', _onPlaylistItemTorrentLoading)
	self.removeListener('playlistItemTorrentSeeding', _onPlaylistItemTorrentSeeding)

}

function _onMessage (msg, alias) {
	// p
	//   span.user From abcdefg
	//   span.message  This is a Message to Everyone

	var p = document.createElement('p')
	var user = document.createElement('span')
	user.className = 'user'
	user.innerHTML = alias + ' : '
	var message = document.createElement('span')
	message.className = 'message'
	message.innerHTML = msg
	p.appendChild(user)
	p.appendChild(message)
	messages.insertBefore(p, messages.firstChild)
}

function _onCommand (msg, alias) {
	util.userCommand('From ' + alias + ' : ' + msg)
}

function _onPeerJoined(peer) {

	var aliasSuffix = peer.king ? '(SK)' : ''
	aliasSuffix += peer.me ? '(Me)' : ''
	var alias = peer.alias + ' ' + aliasSuffix

	if (graph !== null) {
		graph.add({id: peer.peerId, name: alias})
		if (peerId !== peer.peerId)
			graph.connect(peerId, peer.peerId)
	}

	var user = document.createElement('div')
	user.setAttribute('id', peer.peerId)
	user.classList.add('user')
	if (peer.king === true)
		user.classList.add('sk')
	if (peer.me === true)
		user.classList.add('me')

	user.innerHTML = alias
	sessionPeersTable.appendChild(user)

	if (peer.peerId !== peerId)
		util.userCommand(peer.alias + ' is now in session')

}

function _onPeerLeft(peer) {
	var aPeerId = typeof peer === 'object' ? peer.peerId : peer
	var alias = typeof peer === 'object' ? peer.alias : ((session && session instanceof Session && session.peers[aPeerId]) ? session.peers[aPeerId].alias : peer)
	try {
		if (graph !== null) {
			if (peerId !== aPeerId)
				graph.disconnect(peerId, aPeerId)
			graph.remove(aPeerId)
		}

		var oldEl = document.getElementById(aPeerId)
		sessionPeersTable.removeChild(oldEl)
	} catch (e) {}
	util.userCommand(alias + ' left session')

}

function _onPlaylistItemAdded(playlistObject, playlist) {
	var item
	var playlist

	if (playlistObject instanceof Event) {
		item = playlistObject.detail.playlistItem
		playlist = playlistObject.detail.playlist ? playlistObject.detail.playlist : activePlaylist
	} else {
		item = playlistObject.playlistItem
		playlist = playlist ? playlist : activePlaylist
	}

	function onPlay() {
		//util.log('App : adding NowPlaying ' + this.name)
		try {
			document.getElementById(this.playlistItemId).classList.add('nowPlaying')
		} catch(e) {
			util.error('Error setting playNow class to playlist item')
		}
	}

	function onPause() {
		//util.log('App : paused for ' + this.name)
		//document.getElementById(this.playlistItemId).classList.remove('nowPlaying')
	}

	function onAdded() {
		//util.log('App : Adding Queued for ' + this.name)
		document.getElementById(this.playlistItemId).classList.add('queued')
	}

	function onStop() {
		//util.log('App : removing NowPlaying ' + this.name)
		try {
			document.getElementById(this.playlistItemId).classList.remove('nowPlaying')
		} catch(e) {
			util.error('Error removing playNow class to playlist item')
		}
	}

	function onRemove() {
		//util.log('App : Removing NowPlayng and Queued for ' + this.name)
		try {
			var cl = document.getElementById(this.playlistItemId).classList
			cl.remove('nowPlaying')
			cl.remove('queued')
		} catch(e) {
			util.error('Error removing playNow class to playlist item')
		}
	}

	// Return functions for player
	item.onAdded = onAdded
	item.onPlay = onPlay
	item.onPause = onPause
	item.onStop = onStop
	item.onRemove = onRemove


	try {
		var el = document.getElementById(item.playlistItemId)
		if (!el) {
			util.userCommand('Adding ' + item.originalName + ' (' + prettierBytes(item.originalFile.size || item.file.length) + ') to playlist.')

			var el = document.createElement('div')
			el.className = 'filelist-item'
			el.setAttribute('id', item.playlistItemId)
			el.classList.add(item.state)

			var thumb = document.createElement('div')
			var playstop = document.createElement('div')
			playstop.classList.add('control')
			playstop.classList.add('playstop')
			playstop.addEventListener('click', function (e) {
				e.preventDefault()
				if(el.classList.contains('nowPlaying')) {
					player.stop()
				} else {
					player.playItem(item)
				}
			})
			var queue = document.createElement('div')
			queue.classList.add('control')
			queue.classList.add('queue')
			queue.addEventListener('click', function (e) {
				e.preventDefault()
				if(el.classList.contains('queued')) {
					player.dequeueItem(item)
				} else {
					player.queueItem(item)
				}
			})

			thumb.className = 'filelist-item-thumbnail'
			thumb.appendChild(playstop)
			thumb.appendChild(queue)
			el.appendChild(thumb)

			var filenameNode = document.createElement('span')
			filenameNode.innerHTML = item.name
			filenameNode.className = 'filelist-item-filename'
			el.appendChild(filenameNode)

			if (item.author === peerId) {
				var fileremove = document.createElement('a')
				fileremove.innerHTML = '✖'
				fileremove.className = 'filelist-item-remove'
				fileremove.setAttribute('remove-id', item.playlistItemId)
				fileremove.setAttribute('href', '#')
				el.appendChild(fileremove)

				fileremove.addEventListener('click', function (e) {
					e.preventDefault()
					removePlaylistFile(item)
				})
			}

			var fileinfo = document.createElement('span')
			fileinfo.innerHTML = item.type + ' (' + item.ext + ') ' + prettierBytes(item.originalFile.size || item.file.length)
			fileinfo.className = 'filelist-item-info'
			el.appendChild(fileinfo)

			var filestats = document.createElement('span')
			filestats.innerHTML = 'Stats'
			filestats.className = 'filelist-item-stats'
			el.appendChild(filestats)

			playlist.html.appendChild(el)

		}
	} catch(e) {
		util.error('Error adding ' + item.originalName + ' to playlist.')
	}
}

function _onPlaylistItemTorrentLoading(playlistItem) {
	var item
	if (playlistItem instanceof Event) {
		item = playlistItem.detail.playlistItem
	} else {
		item = playlistItem
	}

	try {
		var itemEl = document.getElementById(item.playlistItemId)
		itemEl.classList.remove("added")
		itemEl.classList.add("downloading")
	} catch (e) {
		util.error('Error setting ' + item.id + ' to state \'Downloading\'')
	}

	if(playlistItem.queueId) {
		try {
			var el = document.getElementById(playlistItem.queueId)
			if (el) {
				el.classList.add('downloading')
				el.classList.remove('added')
			}
		} catch(e) {}
	}

}

function _onPlaylistItemTorrentSeeding(playlistItem) {
	var item
	if (playlistItem instanceof Event) {
		item = playlistItem.detail.playlistItem
	} else {
		item = playlistItem
	}

	try {
		var itemEl = document.getElementById(item.playlistItemId)
		itemEl.classList.remove("downloading")
		itemEl.classList.remove("added")
		itemEl.classList.add("seeding")
	} catch (e) {
		util.error('Error setting ' + item.id + ' to state \'Seeding\'')
	}

	if(playlistItem.queueId) {
		try {
			var el = document.getElementById(playlistItem.queueId)
			if (el) {
				el.classList.add('seeding')
				el.classList.remove('downloading')
			}
		} catch(e) {}
	}
}

// TODO - Note used yet
function _onPlaylistUpdated(playlist) {
	var pl
	if (playlist instanceof Event)
		pl = playlist.detail.playlist
	else
		pl = playlist


	if (playlist.html.hasChildNodes()) {

		var e = playlist.html.children;
			[].slice.call(e).sort(function(a, b) {
			var id1 = a.getAttribute('id')
			var id2 = b.getAttribute('id')
			return playlist.playlist[id1].order - playlist.playlist[id2].order
		}).forEach(function(val) {
				playlist.html.appendChild(val)
		})
		util.log('playlist resorted')
		//updatePlaylist('reorder', null, pl
	}
}

function _onPlaylistItemRemoved(playlistItem) {
	var item
	if (playlistItem instanceof Event)
		item = playlistItem.detail.playlistItem
	else
		item = playlistItem.playlistItem

	try {
		var el = document.getElementById(item.playlistItemId)
		el.parentNode.removeChild(el)
		//updatePlaylist('remove', item)
	} catch (e) {
		util.error('Error removing ' + playlistItem.originalName + ' from playlist.')
	}
}

function _onNewPlaylistPeer (wire) {
	var id = wire.peerId.toString()
	util.log('New peer connected to playlist - ' + id)
}


// Playlist interaction functions

function addPlaylistFiles (newFiles) {

	var addedFiles = {}

	newFiles.forEach(function (file, i) {

		var ext = path.extname(file.name).toLowerCase()
		var type
		var index = file.name.lastIndexOf('.')
		var filename = index > 0 ? file.name.slice(0, index) : file.name

		if (VIDEO.includes(ext))
			type = 'VIDEO'
		else if (AUDIO.includes(ext))
			type = "AUDIO"
		else if (IMAGE.includes(ext))
			type = 'IMG'
		else {
			util.warning(file.name + ' - Unknown file type. Skipping')
			return // No go
		}

		addedFiles[file.name] = {
			id: file.name,
			playlistItemId: Math.random().toString(36).slice(2),
			originalName: file.name,
			name: filename,
			ext: ext,
			author: peerId,
			originalFile: file,
			type: type,
			// To be set later
			state: 'added',
			file: {},
			torrent: {},
			hash: ''
		}
	})

	var _onTorrentSeeding = function () {
		var torrent = this

		Object.keys(files[torrent.files[0].name]).forEach(function (htmlId) {
			files[torrent.files[0].name][htmlId].state = 'seeding'
			window.dispatchEvent(new CustomEvent('playlistItemTorrentSeeding',
				{detail: {playlistItem: files[torrent.files[0].name][htmlId]}}))
		})

	}

	var _onPlaylistFileTorrentReady = function(torrent) {

		torrent.pause() // We may not be needing this
		torrents[torrent.infoHash] = torrent

		var item = addedFiles[torrent.files[0].name]
		files[item.id][item.playlistItemId] = item

		torrent.on('warning', util.warning)
		torrent.on('error', util.error)
		torrent.on('wire', _onNewPlaylistPeer)
		torrent.on('seed', _onTorrentSeeding)
		torrent.on('done', _onTorrentSeeding)

		Object.keys(files[item.id]).forEach(function (htmlId) {
			var iItem = files[item.id][htmlId]
			iItem.state = 'downloading'
			iItem.file = torrent.files[0]
			iItem.hash = torrent.infoHash
			iItem.torrent = torrent
			window.dispatchEvent(new CustomEvent('playlistItemTorrentLoading',
				{ detail: {playlistItem: iItem}}))
		})

	}

	var _onPlaylistFileInsert = function(newItem) {

		var duplicateItem
		if (files[newItem.id])
			duplicateItem = files[newItem.id][Object.keys(files[newItem.id])[0]]
		else
			files[newItem.id] = {}

		files[newItem.id][newItem.playlistItemId] = newItem

		// Adding to active playlist
		activePlaylist.playlist.push(newItem)

		window.dispatchEvent(new CustomEvent('playlistItemAdded',
			{ detail: {playlistItem: newItem}}))

		if (duplicateItem) {
			newItem.file = duplicateItem.file
			newItem.torrent = duplicateItem.torrent
			newItem.hash = duplicateItem.hash

			if(duplicateItem.hash !== '')
				window.dispatchEvent(new CustomEvent('playlistItemTorrentLoading', { detail: {playlistItem: newItem}}))

			if (duplicateItem.torrent instanceof Torrent && duplicateItem.torrent.done) {
				window.dispatchEvent(new CustomEvent('playlistItemTorrentSeeding',
					{ detail: {playlistItem: newItem}}))
			}
		} else {
			torrentClient.seed(addedFiles[newItem.id].originalFile, {createdBy: peerId}, _onPlaylistFileTorrentReady)
		}
	}

	Object.keys(addedFiles).forEach(function (id) {
		_onPlaylistFileInsert(addedFiles[id])
	})
}

function updatePlaylistFiles () {
	var keys = [].map.call(activePlaylist.html.children, function(el) {
		return el.getAttribute('id');
	})

	activePlaylist.playlist.sort(function(a, b) {
		var index1 = keys.indexOf(a.playlistItemId)
		var index2 = keys.indexOf(b.playlistItemId)
		return index1 - index2
	})
}

function removePlaylistFile(item) {

	if (activePlaylist.playlist.includes(item)) {

		delete files[item.id][item.playlistItemId]
		if(Object.keys(files[item.id]).length === 0) {
			delete files[item.id]
			if(item.hash !== '') {
				torrentClient.remove(item.hash)
				delete torrents[item.hash]
			}
		}

		activePlaylist.playlist.splice(activePlaylist.playlist.indexOf(item), 1)
		window.dispatchEvent(new CustomEvent('playlistItemRemoved', { detail: { playlistItem: item}}))
	}

	var _onPlaylistTorrentRemoved = function() {
		util.log('A torrent was removed.')
	}
}


// UI Updating functions

function scanOpenSessions() {
	try {
		get.concat({
			url: 'http://' + sessionServer + ':' + sessionServerPort + '/sessions',
			method: 'GET',
			headers: {'user-agent': 'WebTorrent/1.0 (https://webtorrent.io)'}
		}, onResponse)
	} catch (err) {
		util.error('http error from xs param: %s', err)
		return
	}

	function onResponse (err, res, body) {
		if (err) {
			util.error('http error from xs param: %s', err)
			return
		}
		if (res.statusCode !== 200) {
			util.error('non-200 status code %s from xs param: %s', res.statusCode, res.url)
			return
		}

		var newSessions = JSON.parse(body)

		// Sort Old and New

		var keys = Object.keys(newSessions)

		keys.forEach(function (key) {
			if (!sessions[key])
				sessions[key] = {session: new Session(Object.assign(newSessions[key], sessionImmutableOps)), update: true}

		})

		keys = Object.keys(sessions)

		keys.forEach(function (key) {
			if (!newSessions[key]) {
				sessions[key].update = true
				sessions[key].delete = true
			}
		})

		updateSessionsTable()
	}
}

function qrScanSession() {
	util.log('//Need to Create QR Scanning function...')
}

function updateSessionsTable() {

	var _helperSessionTableFunction = function(sess) {

		var tr = document.createElement('tr')
		tr.setAttribute('id', sess.id)

		tr.innerHTML  += '<td>' + sess.name                               + '</td>'
		tr.innerHTML  += '<td>' + (sess.editable ? 'YES' : 'NO') + ' <a href="#" class="playlist-view">(View)</a></td>'
		tr.innerHTML  += '<td>' + sess.peerCount + '</td>'

		if (sess.isKing()) {
			tr.innerHTML += '<td><a href="#" class="sessionOwner">END SESSION</a></td>'
			tr.querySelector('.sessionOwner').addEventListener('click', function (e) {
				e.preventDefault()
				endSession()
			})
		} else if ((session instanceof Session) && (session.id = sess.id)) {
			tr.innerHTML += '<td><a href="#" class="inSession">LEAVE SESSION</a></td>'
			tr.querySelector('.inSession').addEventListener('click', function (e) {
				e.preventDefault()
				endSession()
			})
		} else {
			tr.innerHTML += '<td><a href="#" class="joinSession">JOIN</a></td>'
			tr.querySelector('.joinSession').addEventListener('click', function (e) {
				e.preventDefault()
				joinSession(sess.id)
			})
		}

		return tr

	}

	var keys = Object.keys(sessions)

	keys.forEach(function (info_hash) {
		if (sessions[info_hash].update === true) {
			var oldEl
			try {
				oldEl = document.getElementById(info_hash)
			} catch(e) {}
			if (sessions[info_hash].delete && sessions[info_hash].delete === true && oldEl) {
				delete sessions[info_hash]
				sessionsTable.removeChild(oldEl)
			} else {
				var newEl = _helperSessionTableFunction(sessions[info_hash].session)
				if (oldEl)
					sessionsTable.replaceChild(newEl, oldEl)
				else
					sessionsTable.appendChild(newEl)

				sessions[info_hash].update = false
			}
		}
	})

}

function updateSessionForm() {
	var sessionButton = document.querySelector('button[name=sessionSubmit]')

	if (session instanceof Session && session.isKing()) {
		sessionButton.innerText = 'End Session'
	} else {
		sessionButton.innerText = 'Launch a Session'
	}
}

function loadGraph(create) {
	/*
	if (session instanceof Session && session.isKing() && create && create !== false)
		graph = new Graph('#mygraph')
	else {
		document.querySelector('#mygraph').innerHTML = ''
		graph = null
	}
	*/
}

function deletePlaylist(id) {
	if (playlists[id]) {
		if(playlists[id].tab.classList.contains('active'))
			showPlaylist(Object.keys(playlists)[0])

		// Remove all files registered and possibly torrents
		var torrents = []
		playlists[id].playlist.forEach(function(item) {
			delete files[item.id][item.playlistItemId]
			if (Object.keys(files[item.id]).length === 0) {
				delete files[item.id]
				if (item.hash !== '') {
					torrentClient.remove(item.hash, _onPlaylistTorrentRemoved)
					delete torrents[item.hash]
				}
			}

		})

		playlistTabs.removeChild(playlists[id].tab)
		playlistSection.removeChild(playlists[id].html)
		delete playlists[id]

		var _onPlaylistTorrentRemoved = function() {
			util.log('A torrent was removed.')
		}
	}
}

function newPlaylist(name, fixed) {
	var id = Math.random().toString(36).slice(2)
	var aName = (name && name !== '' ? name : 'New Playlist')
	var newPlTab = document.createElement('li')
	newPlTab.setAttribute('id', id)
	newPlTab.setAttribute('ref-id', 'playlist-' + id)
	var span = document.createElement('span')
	span.setAttribute('contenteditable', true)
	span.innerHTML = aName
	span.addEventListener('click', function(e) {
		e.preventDefault()
		showPlaylist(id)
	})

	span.addEventListener('keypress', function(e) {
		if (e.keyCode === 13) {
			e.preventDefault()
			return;
		}
	})
	span.addEventListener("input", function(e) {
		playlists[id].name = span.innerText
	}, false)

	newPlTab.appendChild(span)
	var loadunload = document.createElement('div')
	loadunload.classList.add('playlist-load')
	loadunload.addEventListener('click', function(e) {
		e.preventDefault()
		if(newPlTab.classList.contains('inSession')) {
			player.dequeueAll(playlists[id].playlist)
			newPlTab.classList.remove('inSession')
		} else {
			player.queueAll(playlists[id].playlist)
			newPlTab.classList.add('inSession')
		}
	})
	newPlTab.appendChild(loadunload)
	if (!fixed || fixed === false) {
		var close = document.createElement('a')
		close.classList.add('playlist-remove')
		close.innerHTML = '✖'
		close.addEventListener('click', function(e) {
			e.preventDefault()
			deletePlaylist(id)
		})
		newPlTab.appendChild(close)
	}

	playlistTabs.insertBefore(newPlTab, newPlaylistAction)

	// div#myPlaylistId.playlistFiles
	var newPl = document.getElementById('playlist-' + id)
	if (!newPl) {
		newPl = document.createElement('div')
		newPl.setAttribute('id', 'playlist-' + id)
		newPl.classList.add('playlistFiles')
		playlistSection.appendChild(newPl)
		Sortable.create(newPl)
		newPl.addEventListener('drop', updatePlaylistFiles)
		// Important!
		playlists[id] = {id: id, name: aName, playlist: [], html: newPl, tab: newPlTab}
	}

	showPlaylist(id)

	return id
}

function showPlaylist(id) {
	Object.keys(playlists).forEach(function(plId) {
		if (plId === id) {
			playlists[plId].html.classList.remove('hidden')
			playlists[plId].tab.classList.add('active')
			activePlaylist = playlists[id]
		} else {
			playlists[plId].html.classList.add('hidden')
			playlists[plId].tab.classList.remove('active')
		}
	})
}

// PLAYER Object
function Player(opts) {
	var self = this
	if (!(self instanceof Player))
		return new Player(opts)

	if (!(opts.targetMediaDiv)) throw new Error('Player requires a html div to load media')
	if (!(opts.targetControlsDiv)) throw new Error('Player requires a html div for controls')
	if (!(opts.targetPlaylistDiv)) throw new Error('Player requires a html div for playlist')
	if (!(opts.targetSongTitleElement)) throw new Error('Player requires a place for titles.')

	self.targetMediaDiv = opts.targetMediaDiv
	self.targetControlsDiv = opts.targetControlsDiv
	self.targetPlaylistDiv = opts.targetPlaylistDiv
	self.targetSongTitleElement = opts.targetSongTitleElement
	self.targetMediaElement = null
	self.queue = []

	self.autoInit = opts.autoInit
	self.autoPlay = opts.autoPlay
	self.autoDequeue = opts.autoDequeue

	// State variables
	self._controlsLoaded = false
	self._mediaLoaded = false
	self._playing = self.autoPlay
	self._queueAt = 0
	self._currentQueueItem = null

	// Controls
	self._playpause = {}
	self._stop = {}
	self._previous = {}
	self._next = {}
	self._fullScreen = {}
	self._seek = {}
	self._mute = {}
	self._volume = {}

	function queueItemAdded(queueItem, index) {
		self.queueAnimation('add', queueItem, index)

		if(queueItem.onAdded && typeof queueItem.onAdded == 'function')
			queueItem.onAdded()

		// A check here on odd occurrences
		if(self._queueAt >= self.queue.length)
			self._queueAt = index

		if (self._queueAt === index && self.queue.length > 0) {
			//if(self._currentQueueItem !== null && self._currentQueueItem.queueId !== queueItem.queueId)
			//	self.emit('mediaEnd', self._currentQueueItem)
			self.queueNext()
		}
	}

	function queueItemRemoved(queueItem, index) {
		self.queueAnimation('remove', queueItem)

		if(queueItem.onRemove && typeof queueItem.onRemove == 'function')
			queueItem.onRemove()

		if(self.queue.length === 0) {
			if(self._currentQueueItem !== null) {
				delete self._currentQueueItem.forceDequeue
				self._currentQueueItem = null
			}
			self._playing = false
			self.unloadMedia()
		} else if (self._queueAt === index) {
			self._currentQueueItem = null
			self.queueNext()
		}
	}

	function mediaReady(queueItem) {
		//console.log('Player: media ready - ' + queueItem.name + ' autoplay: ' + self.autoPlay + ', playing: ' + self._playing + ', el-auto: ' + self.targetMediaElement.autoplay)
		//if(self.autoPlay && self._playing) {
		//	if(queueItem.onPlay && typeof queueItem.onPlay == 'function')
		//		queueItem.onPlay()
		//}
	}

	function mediaEnded(item) {
		//util.log('Player: media ended event - ' + item.name)
		if(self.queue.length === 0) {
			self._playing = false
		} else if(item === undefined) {
			self.queueNext()
		} else {
			self.queueNext(1)
		}
	}

	function _onPlay(item) {
		//util.log('Player: media playing - ' + item.name)
		if(item.onPlay && typeof item.onPlay == 'function')
			item.onPlay()
	}

	function _onPause(item) {
		//util.log('Player: media paused - ' + item.name)
		if(item.onPause && typeof item.onPause == 'function')
			item.onPause()
	}

	function _onStop(item) {
		//util.log('Player: media stopped - ' + item.name)
		if(item.onStop && typeof item.onStop == 'function')
			item.onStop()
	}

	self.on('queueAdd', queueItemAdded)
	self.on('queueRemove', queueItemRemoved)
	self.on('mediaReady', mediaReady)
	self.on('mediaEnd', mediaEnded)

	self.on('play', _onPlay)
	self.on('pause', _onPause)
	self.on('stop', _onStop)
	self.on('previous', util.log)
	self.on('next', util.log)
	self.on('mute', util.log)

}
Player.prototype.dequeueAll = function(arr) {
	var self = this

	arr.forEach(function (item) {
		self.dequeueItem(item)
	})
}
Player.prototype.queueAll = function(arr) {
	var self = this

	arr.forEach(function (item) {
		self.queueItem(item)
	})
}
Player.prototype.playItem = function(playlistItem) {
	var self = this
	var plIds = self.queue.map(function(item) { return item.playlistItemId})
	self._playing = true
	if(plIds.includes(playlistItem.playlistItemId)) {
		self.playAt(plIds.indexOf(playlistItem.playlistItemId))
	} else {
		self.queueItem(playlistItem, self._queueAt + 1)
		playlistItem.forceDequeue = true
	}
}
Player.prototype.playAt = function(index){
	var self = this
	self._queueAt = index
	self.queueNext()
}
Player.prototype.queueItem = function(playlistItem, index) {
	var self = this

	if (!playlistItem.queueId) {
		playlistItem.queueId = Math.random().toString(36).slice(2)
	}

	var newIndex
	if(index === undefined ) newIndex = self.queue.length // Last Element
	else newIndex = (index <= self.queue.length) ? index : self.queue.length

	self.queue.splice(newIndex, 0, playlistItem)
	self.emit('queueAdd', playlistItem, newIndex)
}
Player.prototype.dequeueItem = function(playlistItem) {
	var self = this
	var index = self.queue.indexOf(playlistItem)

	if (index >= 0) {
		self.queue.splice(index, 1)
		self.emit('queueRemove', playlistItem, index)
	}
}
Player.prototype.queueNext = function(index){
	var self = this
	var step = 0
	if(index)
		step = index
	//self._playing = self.autoPlay
	var prevItem = self._currentQueueItem

	if(prevItem !== null && (self.autoDequeue || (prevItem.forceDequeue !== undefined && prevItem.forceDequeue === true))) {
		self.dequeueItem(prevItem)
		return
	}

	if (step > 0) {
		self._queueAt = (self.queue.length > (self._queueAt + step)) ? self._queueAt + step : ((self._queueAt + step) % self.queue.length)
	} else if (step < 0) {
		if(step === -1) {
			if (self.targetMediaElement.currentTime > 15) {
				self.loadMedia()
				return
			}
		}

		var added = self._queueAt + step
		self._queueAt = (0 > added) ? added + self.queue.length : added
	} else if (step === 0 && self._queueAt >= self.queue.length ) {
		self._queueAt = 0
	}
	//if(prevItem)
		//self.emit('mediaEnd', prevItem)

	if(self.queue.length > 0) {
		//console.log('Loading media at queue:' + self._queueAt + ', length : ' + self.queue.length)
		if(self.targetMediaElement !== null && self._currentQueueItem != null && !(self.targetMediaElement.ended)) {
			self.emit('stop', self._currentQueueItem)
		}
		self._currentQueueItem = self.queue[self._queueAt]
		self.loadMedia()
		self.queueAnimation('change', self._currentQueueItem, prevItem)
	} else {
		self.unloadMedia()
	}
}
Player.prototype.loadMedia = function(override) {
	var self = this

	//var auto = (override && override === 'noauto') ? false : self.autoPlay
	//if (auto)
	//	self._playing = true

	function _onEnded() {
		self.emit('stop', self._currentQueueItem)
		self.emit('mediaEnd', self._currentQueueItem)
	}
	function _onReady() {
		self._mediaLoad = true
		self.emit('mediaReady', self._currentQueueItem)
		if(self._playing) {
			self.targetMediaElement.play()
			self.emit('play', self._currentQueueItem)
		}
	}

	if (self.targetMediaElement === null) {
		self.targetMediaElement = document.createElement(self._currentQueueItem.type)
		self.targetMediaDiv.appendChild(self.targetMediaElement)
		self.targetMediaElement.addEventListener('loadstart', _onReady)
		self.targetMediaElement.addEventListener('ended', _onEnded)
	}

	if (self.targetMediaElement.nodeName !== self._currentQueueItem.type) {
		self.targetMediaDiv.removeChild(self.targetMediaElement)
		self.targetMediaElement.removeEventListener('loadstart', _onReady)
		self.targetMediaElement.removeEventListener('ended', _onEnded)
		self.targetMediaElement = null
		self.targetMediaElement = document.createElement(self._currentQueueItem.type)
		self.targetMediaDiv.appendChild(self.targetMediaElement)
		self.targetMediaElement.addEventListener('loadstart', _onReady)
		self.targetMediaElement.addEventListener('ended', _onEnded)
	}

	self.targetMediaDiv.classList.add('loaded')

	if (self._currentQueueItem.file && self._currentQueueItem.file.length) {
		render.render(self._currentQueueItem.file, self.targetMediaElement, {
				controls: false,
				autoplay: false
		  }
		)
	} else if (self._currentQueueItem.originalFile && self._currentQueueItem.originalFile.size) {
		self.targetMediaElement.setAttribute('autoplay', false)
		self.targetMediaElement.setAttribute('src', URL.createObjectURL(self._currentQueueItem.originalFile))
	} else {
		util.error('Could not load media...woops')
		return
	}

	self.setTitle(self._currentQueueItem)
	self.loadPlayerControls()
}
Player.prototype.unloadMedia = function() {
	util.log('PLAYER : Unload called..')
	var self = this
	self.targetMediaDiv.classList.remove('loaded')
	self.setTitle()
	self.unloadPlayerControls()

	if(self.targetMediaElement !== null) {
		//self.targetMediaElement.pause()
		self.targetMediaElement.src = ''
	}
	util.log('Media element destroyed')
	self._mediaLoad = false
}
Player.prototype.loadPlayerControls = function() {
	var self = this

	if (self.targetMediaElement == null) {
		self._controlsLoaded = false
		util.log('No media loaded yet. No controls loaded')
		return
	}

	var links = self.targetControlsDiv.querySelector('div.links')
	var ranges = self.targetControlsDiv.querySelector('div.ranges')
	// Not needed but incase
	self.unloadPlayerControls()


	self._previous = document.createElement('a')
	self._previous.setAttribute('href', '#')
	self._previous.setAttribute('id', 'previous')
	self._previous.addEventListener('click', function (e) {
		e.preventDefault()
		self.previous()
	})
	self._previous.innerHTML = '[prev]'

	self._playpause = document.createElement('a')
	self._playpause.setAttribute('id', 'playpause')
	self._playpause.setAttribute('href', '#')
	self._playpause.addEventListener('click', function (e) {
		e.preventDefault()
			self.playpause()
	})

	if(self._playing)
		self._playpause.innerHTML = '[pause]'
	else
		self._playpause.innerHTML = '[play]'

	self._stop = document.createElement('a')
	self._stop.setAttribute('id', 'stop')
	self._stop.setAttribute('href', '#')
	self._stop.addEventListener('click', function (e) {
		e.preventDefault()
		self.stop()
	})
	self._stop.innerHTML = '[stop]'


	if(self.targetMediaElement.duration != Infinity && !(isNaN(self.targetMediaElement.duration))) {
		var s = document.createElement('a')
		s.classList.add('range-element')
		self._seek = document.createElement('input')
		self._seek.setAttribute('type', 'range')
		self._seek.setAttribute('name', 'seek-bar')
		self._seek.setAttribute('id', 'seek-bar')
		self._seek.classList.add('control-range')
		self._seek.setAttribute('value', 0)
		self._seek.addEventListener('change', function (e) {
			e.preventDefault()
			self.seek(self._seek.value)
		})
		s.appendChild(self._seek)
		ranges.appendChild(self._seek)
	}

	self._next = document.createElement('a')
	self._next.setAttribute('href', '#')
	self._next.setAttribute('id', 'next')
	self._next.addEventListener('click', function (e) {
		e.preventDefault()
		self.next()
	})
	self._next.innerHTML = '[next]'

	self._mute = document.createElement('a')
	self._mute.classList.add('range-element')
	self._mute.setAttribute('href', '#')
	self._mute.addEventListener('click', function (e) {
		e.preventDefault()
		self.muteUnmute()
	})
	self._mute.innerHTML  = '[mute]'


	self._volume = document.createElement('input')
	self._volume.setAttribute('type', 'range')
	self._volume.setAttribute('name', 'volume-bar')
	self._volume.setAttribute('id', 'volume-bar')
	self._volume.classList.add('control-range')
	self._volume.setAttribute('min', 0)
	self._volume.setAttribute('max', 1)
	self._volume.setAttribute('step', 0.1)
	self._volume.setAttribute('value', 1)

	self._volume.addEventListener('change', function (e) {
		e.preventDefault()
		self.volume(self._volume.value)
	})

	self._fullScreen = document.createElement('a')
	self._fullScreen.setAttribute('id', 'fullscreen')
	if(self.targetMediaElement.nodeName === 'VIDEO') {
		self._fullScreen.setAttribute('href', '#')
		self._fullScreen.addEventListener('click', function (e) {
			e.preventDefault()
			self.fullScreen()
		})
	} else {
		self._fullScreen.setAttribute('style', 'text-decoration: line-through; color: #ccc')
	}
	self._fullScreen.innerHTML = '[full screen]'

	links.appendChild(self._mute)
	links.appendChild(self._playpause)
	links.appendChild(self._stop)
	links.appendChild(self._previous)
	links.appendChild(self._next)
	links.appendChild(self._fullScreen)


	ranges.appendChild(self._volume)

	// Additional Seek Listener
	//self.targetMediaElement.addEventListener("timeupdate", function() {
	//	var value = (100 / self.targetMediaElement.duration) * self.targetMediaElement.currentTime
	//	self._seek.value = value
	//})

	self._controlsLoaded = true

}
Player.prototype.unloadPlayerControls = function() {
	var self = this
	var links = self.targetControlsDiv.querySelector('div.links')
	var ranges = self.targetControlsDiv.querySelector('div.ranges')
	links.innerHTML = ''
	ranges.innerHTML = ''
	self._controlsLoaded = false
}
Player.prototype.playpause = function() {
	var self = this

	if(self._playing === false || self.targetMediaElement.paused === true) {
		self._playing = true
		self.targetMediaElement.play()
		self._playpause.innerHTML = '[pause]'
		self.emit('play', self._currentQueueItem)
	} else {
		self.targetMediaElement.pause()
		self._playing = false
		self._playpause.innerHTML = '[play]'
		self.emit('pause', self._currentQueueItem)
	}
}
Player.prototype.stop = function() {
	var self = this
	self._playing = false
	self._playpause.innerHTML = '[play]'
	//self.unloadMedia()
	self.emit('stop', self._currentQueueItem)
	self.emit('mediaEnd')
}
Player.prototype.previous = function() {
	var self = this
	self.emit('stop', self._currentQueueItem)
	self.queueNext(-1)
}
Player.prototype.next = function() {
	var self = this
	self.emit('stop', self._currentQueueItem)
	self.queueNext(1)
}
Player.prototype.seek = function(seek) {
	var self = this
	var el = self.targetMediaElement
	var time = el.duration * (seek / 100);
	el.currentTime = time;
}
Player.prototype.volume = function(vol) {
	var self = this
	var el = self.targetMediaElement
	el.volume = vol
}
Player.prototype.muteUnmute = function() {
	var self = this
	var el = self.targetMediaElement
	if (el.muted == false) {
		el.muted = true
		self._mute.innerText = "[unmute]";
	} else {
		el.muted = false
		self._mute.innerText = "[mute]";
	}
}
Player.prototype.fullScreen = function() {
	var self = this
	var el = self.targetMediaElement

	if (el.requestFullscreen) {
		el.requestFullscreen();
	} else if (el.mozRequestFullScreen) {
		el.mozRequestFullScreen(); // Firefox
	} else if (el.webkitRequestFullscreen) {
		el.webkitRequestFullscreen(); // Chrome and Safari
	}

}
Player.prototype.queueAnimation = function(action, item, oldItem) {
	var self = this
	// First highligh the correcy queue item
	switch(action) {
		case 'add' :
			var el = document.createElement('div')
			el.setAttribute('id', item.queueId)
			el.classList.add('item')
			el.classList.add(item.state)
			el.innerHTML = '<span class="links">' +
				'  <a href="#">[torrent]</a>' +
				'  <a href="#">[save]</a>' +
				'  <a class="queue-remove" href="#">[remove]</a>' +
				'</span>' +
				'<span class="itemTitle">' + item.name + '</span>' +
				'<span class="stats">No stats</span>'

			el.querySelector('a.queue-remove').addEventListener('click', function() {
				self.dequeueItem(item)
			})

			var children = self.targetPlaylistDiv.children
			if (oldItem && children.length > oldItem)
				self.targetPlaylistDiv.insertBefore(el, children[oldItem])
			else
				self.targetPlaylistDiv.appendChild(el)

			break
		case 'remove':
			var el = document.getElementById(item.queueId)
			self.targetPlaylistDiv.removeChild(el)
			break
		case 'change' :
			var el1 = document.getElementById(item.queueId)
			el1.classList.add('nowPlaying')

			if(oldItem && oldItem !== item) {
				var el2 = document.getElementById(oldItem.queueId)
				if(el2)
					el2.classList.remove('nowPlaying')
			}
			break
		default :
			break
	}

	function animateQueue(step) {
		if (step === 0) {
			sessionPlayerPlaylist.style.top = 0
			return
		}

		var pos = parseInt(sessionPlayerPlaylist.style.top.substring(0, sessionPlayerPlaylist.style.top.indexOf('px')))
		var target = step * 71
		var id

		sessionPlayerPlaylist.style.top = target + 'px'

		//if (target > pos)
		//	id = setInterval(frameUp, 5);
		//else
		//	id = setInterval(frameDown, 5);

		function frameUp(move) {
			if (pos >= target) {
				clearInterval(id);
				sessionPlayerPlaylist.style.top = target + 'px'
			} else {
				pos = pos + 5
				sessionPlayerPlaylist.style.top = pos + 'px'
			}
		}
		function frameDown(move) {
			if (pos <= target) {
				sessionPlayerPlaylist.style.top = target + 'px'
				clearInterval(id);
			} else {
				pos = pos - 5
				sessionPlayerPlaylist.style.top = pos + 'px'
			}
		}
	}

	var queueLength = self.queue.length
	var step = 0
	if (queueLength > 4)
		step = self._queueAt < 2 ? 0 : ((queueLength - self._queueAt) < 4 ?  queueLength - 4  : self._queueAt - 1 )

	animateQueue(step * -1)

}
Player.prototype.setTitle = function(queueItem) {
	var self = this
	var newTitle = ''
	var state = ''
	var intro = ''

	if (queueItem) {
		newTitle = queueItem.name
		if(self._playing)
			state = '[playing] :'
		else
			state = '[stopped] :'
	} else {
		state = '[offline] :'
		newTitle = '...'
	}

	self.targetSongTitleElement.innerHTML = state +
		'<span class="songName">' + newTitle + '</span>' +
		'<span class="upNext">[QUEUE]</span>'
}

player = new Player({
	autoDequeue: false,
	autoPlay: false,
	targetMediaDiv: playerDiv,
	targetControlsDiv: controls,
	targetPlaylistDiv: sessionPlayerPlaylist,
	targetSongTitleElement: playerSongTitle
})



// SESSION Object

function Session(opts) {
	var self = this

	if (!(self instanceof Session)) return new Session(opts)

	//EventEmitter.call(self)
	if (!opts) opts = {}

	// Set once only
	if (!(opts.client)) throw new Error('Torrent Client required')
	if (!(opts.owner)) throw new Error('Session owner required')
	if (!(opts.ownerAlias)) throw new Error('Session owner Name required')

	self.playlist = []
	// TODO Session Torrents - incase removed from Playlist but still in Queue
	self.sessionTorrents = []

	if (opts.player) {
		// This is a local session
		self.player = opts.player
		self.playlist = self.player.queue

	} else if (opts.playlist) {
		self.playlist = opts.playlist
	}

	self.owner  = opts.owner
	self.ownerAlias  = opts.ownerAlias
	self.client = opts.client

	self.peerSocket = {}
	self.peers = {}
	self.peers[self.owner] = {peerId: self.owner, alias: screenName, king: true, socket: {}}

	self.peerCount = 1

	self.offset = 0

	if(opts.name) {
		self.name = opts.name
	} else {
		self.name = self.ownerAlias
	}

	if(opts.id) {
		self.id = opts.id
	} else {
		self.id = self.owner + '/' + self.name.replace(/\s+/g, '-')
	}

	self.isKing = function () {
		var self = this
		return self.client.peerId === self.owner ? true : false
	}

	self.lastUpdated
	self.registrationInterval = null
}

Session.prototype.startSession = function (player) {
	var self = this

	self.peers[self.owner].me = true

	self.emit('start', self)

	if (!self.isKing()) {
		util.warning('You do not own this session')
		return
	}

	var _registerSession = function(session) {
		var self = session
		self.lastUpdated = new Date()

		var payload = JSON.stringify(self, self._replacer)

		//util.log('About to register session with server: ' + payload)
		try {
			get.concat({
				url: 'http://' + sessionServer + ':'+ sessionServerPort + '/startsession',
				method: 'POST',
				body: payload,
				headers: {'user-agent': 'WebTorrent/1.0 (https://webtorrent.io)'}
			}, onResponse)
		} catch (err) {
			util.error('http error from xs param: %s', err)
			return
		}

		function onResponse (err, res) {
			if (err) {
				util.error('http error from xs param: %s', err)
				return
			}
			if (res.statusCode !== 200) {
				util.warning('Session response - invalid Status code.')
				return
			}
			self.emit('registered', self)
		}
	}

	var _onSessionWarning = function(err) { util.warning(err) }

	var _onSessionError = function(err) { util.error(err) }

	var _sessionListeners = self.sessionListeners.bind(self)
	getRtcConfig(_sessionListeners)

	//if (self.public)
		_registerSession(self)

	self.registrationInterval = setInterval(function() {_registerSession(self)}, 60000)

	self.emit('joined', self)
	self.emit('addPeer', self.peers[self.owner])
}

Session.prototype.addSourceMedia = function(items, cb) {
	var self = this
	var list = []
	if (items.id)
		list[items.id] = items
	else
		list = items

	var _onTorrentSeeding = function(torrent) {
		list.forEach(function(item, i) {
			if(item.hash === hash) {
				item.state = 'downloading'
				self.emit('playlistItemTorrentSeeding', item)
			}
		})
	}

	var _onPlaylistMeta = function(torrent) {

		var file = torrent.files[0]
		var hash = torrent.infoHash


		list.forEach(function(item, i) {
			if(item.hash === hash) {
				item.torrent = torrent
				item.file = file
				item.state = 'downloading'
				self.emit('playlistItemTorrentLoading', item)
			}
		})

		self.sessionTorrents[torrent.infoHash] = torrent

		torrent.on('warning', util.warning)
		torrent.on('error', util.error)
		torrent.on('wire', _onNewPlaylistPeer)
		torrent.on('seed', _onTorrentSeeding)
		torrent.on('done', _onTorrentSeeding)

	}

	list.forEach(function(key, i) {
		self.client.add(list[i].hash, _onPlaylistMeta)
	})

}

Session.prototype.updateSourceMedia = function(items, cb) {
	var self = this
	var keys = Object.keys(self.playlist)
	var flag = false

	if (keys.length !== Object.keys(items).length) {
		util.error('Cannot sort unless current and new playlist are of same length')
		return
	}

	keys.forEach(function(key) {
		if (self.playlist[key].order !== items[key].order) {
			self.playlist[key].order = items[key].order
			flag = true
		}
	})

	self.emit('playlistUpdated', self.playlist)

	if (flag) {
		if (typeof cb === 'function') {
			cb(self.playlist, null, 'update')
		}
	}
}

Session.prototype.removeSourceMedia = function(item, cb) {

	var self = this

	var _onTorrentRemoved = function() {
		delete self.playlistTorrents[hash]
	}

	if (self.playlist[item.id]) {
		var itemIndex = self.playlist[item.id].order
		var hash = self.playlist[item.id].hash
		delete self.playlist[item.id]

		// Remove torrent
		if (self.playlistTorrents[hash]) {
			self.client.remove(self.playlistTorrents[hash], _onTorrentRemoved)
		}

		// Rearrange
		var keys = Object.keys(self.playlist)
		keys.forEach(function(key) {
			if(self.playlist[item.id].order > itemIndex)
				self.playlist[item.id].order--
		})

		// Emit changes
		self.emit('playlistItemRemoved', item)

		// Emit changes to all peers
		if (typeof cb === 'function') {
			cb(item, 'remove')
		}
	} else {
		util.error('Media ' + item.id + ' does not exist.')
	}
}

Session.prototype.emitPlaylist = function(playlist, plItem, action, cb) {
	var self = this
	var response = {peerId: peerId, type: 'playlist', action: action, playlist: playlist, playlistItem: plItem}
	var event

	if (action === 'add')
		event = 'playlistItemAdded'
	else if (action === 'remove')
		event = 'playlistItemRemoved'
	else if (action === 'reorder')
		event = 'playlistUpdated'

	self.emit(event, response)
	self.broadCastAll(response)

	if (typeof cb == 'function')
		cb({eventType: event, response: response})

	util.userCommand('Sesison playlist synced with peers')
}

Session.prototype.endSession = function() {
	var self = this

	// TODO Deseed all the torrents
	/*

	Object.keys(self.playlistTorrents).forEach(
		function(key) {
			self.client.remove(self.playlistTorrents[key], _removePlaylistTorrent)
			util.log('Removing playlist torrent ' + self.playlistTorrents[key].infoHash)
		}
	)

	*/

	// Remove all the files
	self.playlist = []
	self.playlistTorrents = {}
	util.log('Removing session playlist')
	// Destroy the session in the registry

	if (self.isKing())
		_destroySessionRegistry()

	self.sessionListeners('remove', null)

	self.peerSocket.destroy()
	self.peers = {}
	self.emit('end', self)
	clearInterval(self.registrationInterval)
	function _destroySessionRegistry() {
		try {
			get.concat({
				url: 'http://' + sessionServer + ':' + sessionServerPort + '/endsession/' + self.id,
				method: 'GET',
				headers: {'user-agent': 'WebTorrent/1.0 (https://webtorrent.io)'}
			}, onResponse)
		} catch (err) {
			util.error('http error from xs param: %s', err)
			return
		}

		function onResponse (err, res) {
			if (err) {
				util.error('http error from xs param: %s', err)
				return
			}
			if (res.statusCode !== 200) {
				util.warning('Session response - invalid Status code.')
				return
			}
			util.log('Destroyed session.')
			self.emit('deregistered', self)
		}

	}

	function _removePlaylistTorrent () {
		//util.log('Removed Playlist torrent')
	}

}

Session.prototype.joinSession = function (player) {
	var self = this

	var setupSKConnection = function (err, rtcConfig) {

		var newSKSessionConnection = function(id) {

			var newSessionConnection = function () {
				util.userCommand('Syncing with session leader...')

				var responses = []

				var syncDataReceived = function (data) {
					data.roundtrip = new Date().getTime()
					responses.push(data)

					if (responses.length > 50) {
						clearInterval(intervalId)
						conn.removeListener('data', syncDataReceived)
						conn.removeListener('open', newSessionConnection)
						//conn.removeListener('error', util.error)
						var offset = calculateOffset(responses)
						util.userLog('Internal Clock offset is ' + offset + ' milliseconds')
						self.offset = offset
						self.registerNewPeer(self.owner, self.ownerAlias, conn, true, true)
						conn.send({type: 'joinRequest'})
					}
				}

				var sync = function () {
					conn.send({peerId: peerId, time: new Date().getTime(), type: 'syncRequest'})
				}

				conn.on('data', syncDataReceived)
				var intervalId = setInterval(sync, 50)
			}

			var conn = self.peerSocket.connect(self.owner, {metadata: {peerId: peerId, alias: screenName}})
			conn.on('error', function(err) {
				util.error('Ok error here ' + err)
			})
			conn.on('open', newSessionConnection)
		}

		if (!(self.peerSocket instanceof Peer) || self.peerSocket.disconnected) {
			self.sessionListeners(null, rtcConfig)
			self.peerSocket.once('open', newSKSessionConnection)
		} else {
			newSKSessionConnection(self.peerSocket.id)
		}
	}

	self.player = player
	getRtcConfig(setupSKConnection)

}

Session.prototype.sessionListeners = function (err, rtcConfig) {
	var self = this
	if (err) {
		try {
			self.peerSocket.removeListener('open', _onSessionChannelOpen)
			self.peerSocket.removeListener('connection', _onSessionPeerConnected)
			self.peerSocket.removeListener('close', _onSessionChannelClosed)
			self.peerSocket.removeListener('disconnected', _onSessionChannelClosed)
			self.peerSocket.removeListener('error', _onSessionChannelError)

			Object.keys(self.peers).forEach(function(key) {
				if (self.peers[key].socket instanceof DataConnection)
					self.registerNewConnection(key, self.peers[key].socket, true)
			})

		} catch(e) {
			util.error(err)
		}
		return
	}

	var _onSessionChannelOpen = function(id) {
		util.userCommand('Session WebRTC opened and waiting...')
	}

	var _onSessionPeerConnected = function(conn) {
		util.log('Session Channel opened for peerId ' + conn.metadata.peerId)
		self.registerNewConnection(conn.metadata.peerId, conn)
	}

	var _onSessionChannelClosed = function() {
		util.log('Session Channel closed properly.')
	}

	var _onSessionChannelDisconnected = function() { util.error('Session P2P Channel disconnected. What to do...??') }

	var _onSessionChannelError = function(err) {
		util.error('Fatal Session P2P Channel Error : ' + err.message)
		self.peerSocket.destroy()
	}

	if (!(self.peerSocket instanceof Peer) || self.peerSocket.disconnected) {
		self.peerSocket = new Peer(peerId,
			{
				host: sessionServer,
				port: 9100,
				path: '/peerjs',
				iceServers: rtcConfig
			}
		)

		self.peerSocket.on('open', _onSessionChannelOpen)
		self.peerSocket.on('connection', _onSessionPeerConnected)
		self.peerSocket.on('close', _onSessionChannelClosed)
		self.peerSocket.on('disconnected', _onSessionChannelClosed)
		self.peerSocket.on('error', _onSessionChannelError)
	}
}

Session.prototype._onSessionMessage = function(conn, msg) {
	var self = this
	switch(msg.type) {
		case 'beepTestRequest' :
			var beepTestTime = (new Date().getTime()) + 3000
			conn.send({type : 'beepTest', at: beepTestTime})
			setTimeout(function() {
				//beepTest.play()
				util.userCommand('Playing beep test')
			}, (beepTestTime - (new Date().getTime())))
			util.userCommand('Beep testing at ' + beepTestTime + ' (local)')
			break
		case 'beepTest' :
			setTimeout(function() {
				//beepTest.play()
				util.userCommand('Playing beep test')}, ((msg.at - self.offset) - (new Date().getTime())))
			util.userCommand('beep testing at ' + (msg.at + self.offset) + ' milli (offset = ' + self.offset+ ')')
			break
		case 'joinRequest' :
			if (self.isKing()) {
				self.registerNewPeer(conn.metadata.peerId, conn.metadata.alias, conn, false, false)
				conn.send({
					approved: true,
					session: JSON.parse(JSON.stringify(self, self._replacer)),
					//peers: omit(self.peers, 'socket', true, true),
					//playlist: omit(self.playlist, 'file', true, true),
					type: 'inSession'
				})
				self.emit('addPeer', conn.metadata)
				self.broadCastAll({type: 'inSession', peerId: conn.metadata.peerId, alias: conn.metadata.alias})
				util.log('A joinRequest was received from: ' + conn.metadata.alias + '. Accepting.')
			} else {
				util.warning('A joinRequest was received from : ' + conn.metadata.alias + '. Ignoring')
			}
			break
		case 'inSession' :
			if (msg.approved) {  // For you

				self.peers[peerId] = {peerId: peerId, alias: screenName, king: false, me: true, socket: {}}
				self.emit('joined', self)
				self.emit('addPeer', self.peers[self.owner])
				self.emit('addPeer', self.peers[peerId])

				Object.keys(msg.session.peers).forEach(function (key) {
					if (!self.peers[key]) {
						self.registerNewPeer(key, msg.session.peers[key].alias)
						self.emit('addPeer', self.peers[key])
					}
				})
				Object.keys(self.peers).forEach(function (key) {
					if (!msg.session.peers[key]) {
						self.emit('removePeer', self.peers[key])
						delete self.peers[key]
					}
				})

				self.addSourceMedia(msg.session.playlist)

			} else if (msg.peerId) {
				if (!self.peers[msg.peerId]) {
					self.registerNewPeer(msg.peerId, msg.alias)
					self.emit('addPeer', msg)
				}
			}
			break
		case 'outSession' :
			self.emit('removePeer', msg.peerId)
			delete self.peers[msg.peerId]
			break
		case 'fileRequest' :
			break
		case 'file' :
			break
		case 'playlist' :
			if (msg.action === 'reorder') {
				self.updateSourceMedia(msg.playlist)
			}
			else if (msg.action === 'add') {
				self.addSourceMedia(msg.playlistItem)
			}
			else if (msg.action === 'remove') {
				self.removeSourceMedia(msg.playlistItem)
			}
			break
		case 'message' :
			self.emit('message', msg.message, self.peers[msg.peerId].alias)
			break
		case 'command' :

			self.emit('command', msg.command, self.peers[msg.peerId].alias)
			break
		default :
			util.log('Unknown request from ' + conn.label)
			return
	}

	//util.log('From: ' + conn.label + ' : ' + JSON.stringify(msg))
}

Session.prototype.sendMessage = function (peers, msg) {
	var self = this
	if (peers === 'all') {
		self.broadCastAll({peerId: peerId, type: 'message', message: msg})
		self.emit('message', msg, 'To all') // For sender...
	}
}

Session.prototype.sendCommand = function (command) {
	var self = this
	self.broadCastAll({peerId: peerId, type: 'command', command: command})
}

Session.prototype.broadCastAll = function(msg, excluded) {
	var self = this
	var myPeers = Object.keys(self.peers).filter(function(key) {
			return (key !== excluded) && (self.peers[key].me !== true)
		})

	myPeers.forEach(function (key) {
		if (self.peers[key].socket instanceof DataConnection && self.peers[key].socket.open)
			self.peers[key].socket.send(msg)
		else {
			var conn = self.peerSocket.connect(key, {metadata : {peerId: peerId, alias: screenName}})
			try {
				conn.once('open', function () {
					conn.send(msg)
				})
				self.registerNewConnection(key, conn)
			} catch(e) {
				util.warning('Could not broadcast to peer: ' + self.peers[key].alias)
			}
		}
	})
}

Session.prototype.registerNewPeer = function(id, alias, conn, isKing, registerConnection) {
	var self = this
	util.log('New Peer registered: ' + alias + ', ID' + id)

	self.peers[id] = {peerId : id, alias: alias, king: isKing ? isKing : false, socket : conn ? conn : {}}
	self.peerCount = Object.keys(self.peers).length
	if (conn && registerConnection === true) {
		util.log('New Peer connection registering: ' + alias + ', ID' + id + ' conn = ' + conn + ', registerConnection = ' + registerConnection)
		self.registerNewConnection(id, conn)
	}
}

Session.prototype.registerNewConnection = function(targetPeerId, conn, deregister) {
	var self = this
	if (deregister) {
		conn.removeListener('open', connOpened)
		conn.removeListener('data', connData)
		conn.removeListener('close', connClosed)
		conn.removeListener('error', connError)
		return
	}

	var connOpened = function(){
		util.log('Channel with \'' + targetPeerId + '\' opened')
	}
	var connData = function (data) {
		if (data.type === 'syncRequest') {
			data.kingTime = new Date().getTime()
			conn.send(data)
			return
		}

		self._onSessionMessage(conn, data)
	}
	var connClosed = function(){
		if (self.peers[targetPeerId].king === true) {
			util.warning('Channel with SESSION KING closed. Exiting Session')
			self.endSession()
		} else if(self.isKing()) {
			util.warning('Channel with \'' + self.peers[targetPeerId].alias + '\' closed.')
			self.emit('removePeer', session.peers[targetPeerId])
			delete self.peers[targetPeerId]
			self.broadCastAll({type: 'outSession', peerId: targetPeerId})
		}
	}
	var connError = function(err){
		util.error('Session P2P Connection error: ' + err)
	}

	util.log('New Peer connection registered: ' + conn.metadata.alias + ', ID' + conn.metadata.peerId)
	conn.on('open', connOpened)
	conn.on('data', connData)
	conn.on('close', connClosed)
	conn.on('error', util.error)

}

Session.prototype._replacer = function(name, value) {
	// Avoiding circular loops here
	if (typeof name == 'function') return undefined
	else if (name.toLowerCase().indexOf('torrent') > -1) return undefined
	else if (name.toLowerCase().indexOf('file') > -1) return undefined
	else if (name.toLowerCase().indexOf('socket') > -1) return undefined
	else if (name === 'client') return undefined
	else if (name === 'player') return undefined

	return value
}


// Helper methods

var calculateOffset = function(responses) {

	var tinyOffset = 0
	var targetStdDev = 0.5
	var weight = 0.95

	var total = 0
	// Calculate the raw variables
	for (var i = 0; i < responses.length; i++) {
		//responses[i].AandB = responses[i].roundtrip - responses[i].client
		responses[i].offsetAndA = responses[i].kingTime - responses[i].time
		responses[i].offsetLessB = responses[i].kingTime - responses[i].roundtrip
		responses[i].baseOffset = (responses[i].offsetAndA + responses[i].offsetLessB) / 2
		total += responses[i].baseOffset
	}
	// Get the average offset
	var average = total / responses.length
	var totalDevs = 0

	// Calulcate the deviation from the average
	for (var j = 0; j < responses.length; j++) {
		responses[j].dev = Math.pow((responses[j].baseOffset - average), 2)
		totalDevs += responses[j].dev
	}

	// Calculate the Std Dev for the data set
	var stdDev = Math.sqrt(totalDevs / responses.length)
	var creamTotal = 0
	var creamCount = 0

	// Calculate the std. Dev for each record and only include values within target deviation
	for (var k = 0; k < responses.length; k++) {
		responses[k].stdDev = (average - responses[k].baseOffset) / stdDev
		if (responses[k].stdDev <= targetStdDev && responses[k].stdDev >= -targetStdDev) {
			creamTotal += responses[k].baseOffset
			creamCount++
		}
	}

	// Return the averate for the records within target deviation
	//console.log(JSON.stringify(responses))
	return Math.floor(((creamTotal / creamCount) - tinyOffset))

}

var omit = function(obj, omitKeys, nested, includeBlanks) {
	var omitted
	var newObj = {}

	if (typeof omitKeys == 'string')
		omitted = [omitKeys]
	else
		omitted = omitKeys

	Object.keys(obj).map(function (key) {
		if (omitted.includes(key)) {
			if (includeBlanks)
				newObj[key] = {}
		} else {
			if (nested && typeof obj[key] === 'object' && obj[key] !== null) {
				newObj[key] = omit(obj[key], omitted, false, includeBlanks)
			} else {
				newObj[key] = obj[key]
			}
		}
	})

	return newObj
}
