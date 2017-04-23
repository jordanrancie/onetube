/**
 * Created by jorda on 17/01/2017.
 */

var fs = require("fs");
var fileName = "C:/Users/jorda/Google Drive/timesynctest5.json";

fs.exists(fileName, function(exists) {
	if (exists) {
		fs.stat(fileName, function(error, stats) {
			fs.open(fileName, "r", function(error, fd) {
				var buffer = new Buffer(stats.size);

				fs.read(fd, buffer, 0, buffer.length, null, function(error, bytesRead, buffer) {
					var data = JSON.parse(buffer.toString("utf8", 0, buffer.length));
					var rec
					rec = data[0]
					var headings = Object.keys(rec)
					var top = ''

					for (var i = 0; i < headings.length; i++)
						top += headings[i] + ','

					console.log(top)

					for (var k = 0; k < data.length; k++) {
						rec = data[k]
						var row = ''

						for (var j = 0; j < headings.length; j++) {
							row += rec[headings[j]] + ','
						}

						console.log(row);
					}

					fs.close(fd);
				})
			})
		})
	}
})
