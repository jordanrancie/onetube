var logElem = exports.logElem = document.querySelector('#messages')
var speed = document.querySelector('.speed')
var logHeading = document.querySelector('#logHeading')


exports.userCommand = function log(item) {
	console.log('User Command: ' + item)
	var p = document.createElement('p')
	p.className = 'command'
	p.innerHTML = item
	logElem.insertBefore(p, logElem.firstChild)
	return p

}

exports.userLog = function log (item) {
	if (typeof item === 'string') {
		console.log('User Logging: ' + item)
		var p = document.createElement('p')
		p.className = 'logging'
		p.innerHTML = item
		logElem.insertBefore(p, logElem.firstChild)
		return p
	} else {
		console.log(item)
		logElem.insertBefore(item, logElem.firstChild)
		return item
	}
}

exports.log = function log (item) {
  /*
	if (typeof item === 'string') {
    var p = document.createElement('p')
    p.className = 'logging'
    p.innerHTML = '&nbsp; &nbsp; log: ' + item
		logElem.insertBefore(p, logElem.firstChild)
  } else {

	  logElem.insertBefore(item, logElem.firstChild)
  }
  */
	console.log(item)
	return item
}
// replace the last P in the log
exports.updateSpeed = function updateSpeed (str) {
	exports.log(str)
}

exports.warning = function warning (err) {
	if (typeof err === 'string') {
		var p = document.createElement('p')
		p.className = 'logging'
		p.innerHTML = err
		logElem.insertBefore(p, logElem.firstChild)
		p.className = 'warning'
	} else {
		logElem.insertBefore(err, logElem.firstChild)
	}
	console.log(err)
}

exports.error = function error (err) {
	var text
	if (typeof err === 'string') {
		text = err
	} else {
		text = err.message
	}

	var p = document.createElement('p')
	p.innerHTML = err
	logElem.insertBefore(p, logElem.firstChild)
	p.className = 'error'
	console.log(text)
}
