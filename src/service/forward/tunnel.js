var net = require('net');
var debug = require('debug')('tunnel-ssh');
var Connection = require('ssh2');
var createConfig = require('./lib/config');
var events = require('events');
var noop = function () {
};

var tunelMark = {};

function getId(config) {
    return `${config.host}_${config.port}_${config.localHost}_${config.localPort}_${config.remoteHost}_${config.remotePort}`;
}

function bindSSHConnection(config, netConnection) {
    let id = getId(config)
    if (tunelMark[id]) {
        const stream = tunelMark[id].stream
        netConnection.emit('sshStream', stream);
        netConnection.pipe(stream).pipe(netConnection);
        return;
    }

    var sshConnection = new Connection();
    sshConnection.on('ready', function () {
        debug('sshConnection:ready');
        netConnection.emit('sshConnection', sshConnection, netConnection);
        sshConnection.forwardOut(config.srcHost, config.srcPort, config.dstHost, config.dstPort, function (err, sshStream) {
            if (err) {
                // Bubble up the error => netConnection => server
                netConnection.emit('error', err);
                debug('Destination port:', err);
                return;
            }

            debug('sshStream:create');
            tunelMark[id] = { connection: sshConnection, stream: sshStream }
            netConnection.emit('sshStream', sshStream);
            netConnection.pipe(sshStream).pipe(netConnection);
        });
    });
    return sshConnection;
}

function createServer(config) {
    var server;
    var connections = [];
    var connectionCount = 0;

    server = net.createServer(function (netConnection) {
        var sshConnection;
        connectionCount++;
        netConnection.on('error', server.emit.bind(server, 'error'));
        netConnection.on('close', function () {
            connectionCount--;
            if (connectionCount === 0) {
                if (!config.keepAlive) {
                    setTimeout(function () {
                        if (connectionCount === 0) {
                            server.close();
                            tunelMark[getId(config)].connection.end()
                            delete tunelMark[getId(config)]
                        }
                    }, 2);
                }
            }
        });

        server.emit('netConnection', netConnection, server);
        sshConnection = bindSSHConnection(config, netConnection);
        sshConnection.on('error', server.emit.bind(server, 'error'));

        netConnection.on('sshStream', function (sshStream) {
            sshStream.on('error', function () {
                server.close();
            });
        });

        connections.push(sshConnection, netConnection);
        sshConnection.connect(config);
    });

    server.on('close', function () {
        connections.forEach(function (connection) {
            connection.end();
        });
    });

    return server;
}

function tunnel(configArgs, callback) {
    var server;
    var config;

    if (!callback) {
        callback = noop;
    }
    try {
        config = createConfig(configArgs);
        server = createServer(config);

        server.listen(config.localPort, config.localHost, function (error) {
            callback(error, server);
        });
    } catch (e) {
        server = new events.EventEmitter();
        setImmediate(function () {
            callback(e);
            server.emit('error', e);
        });
    }
    return server;
}

module.exports = tunnel;
