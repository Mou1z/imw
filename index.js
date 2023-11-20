const express = require("express");
const axios = require('axios');
const path = require('path');
const ws = require('ws');

const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const { publicDecrypt } = require("crypto");
const io = new Server(server);

const port = process.env.PORT || 3000;
app.use(express.static(__dirname + '/public'));

let appData = {
    onGoingSession: null,
    sessionName: null,
    isWinning: null,
    pitStops: null
};

async function main() {
	try {
		const resp = await negotiate();

		console.log(resp.data);
		console.log(resp.headers);
		const sock = await connectwss(resp.data['ConnectionToken'], resp.headers['set-cookie']);

        setInterval(() => {
            sock.send(JSON.stringify(
                {
                    "H": "Streaming",
                    "M": "Subscribe",
                    "A": [["SessionInfo", "DriverList", "TopThree", "TimingData"]],
                    "I": 1
                }
            ));
        }, 2000);

	} catch(e) {
		console.error(e);
        console.log('Socket connection failed. Will attempt reconnection in 60 seconds.');
        setTimeout(function() {
            console.log('Attempting socket connection.');
            main();
        }, 60 * 1000);
	}
}

async function negotiate() {
	const hub = encodeURIComponent(JSON.stringify([{name:"Streaming"}]));
	const url = `https://livetiming.formula1.com/signalr/negotiate?connectionData=${hub}&clientProtocol=1.5`
	const resp = await axios.get(url);
	return resp;
}

async function connectwss(token, cookie) {
	const hub = encodeURIComponent(JSON.stringify([{name:"Streaming"}]));
	const encodedToken = encodeURIComponent(token);
	const url = `wss://livetiming.formula1.com/signalr/connect?clientProtocol=1.5&transport=webSockets&connectionToken=${encodedToken}&connectionData=${hub}`
	const p = new Promise((res, rej) => {
		const sock = new ws.WebSocket(url, {headers: {
			'User-Agent': 'BestHTTP',
			'Accept-Encoding': 'gzip,identity',
			'Cookie': cookie
		}});

        sock.onclose = function (event) {
            console.log('Socket is closed. Reconnect will be attempted in 60 seconds.', event.reason);
            setTimeout(function() {
                main();
            }, 60 * 1000);
        };

		sock.on('open', ev => {
			res(sock);
		});
        
		sock.on('message', (data) => {

			console.log('received %s', data);
            data = JSON.parse(data);

            if(data.hasOwnProperty('R')) {
                let timeOffset = data['R']['SessionInfo']['GmtOffset'].slice(0, -3);
                if(timeOffset[0] != '-')
                    timeOffset = '+' + timeOffset;
                const endDate = new Date(data['R']['SessionInfo']['EndDate'] + timeOffset);
                const now = new Date();
                if(now > endDate) {
                    if(appData['onGoingSession'] === true || appData['onGoingSession'] === null) {

                        const updateSessionName = () => { 

                            axios.get("http://ergast.com/api/f1/current.json")
                            .then((response) => {
                                let newName = '';
                                let data = response.data;
                                let races = data['MRData']['RaceTable']['Races'];

                                for(let i = 0; i < races.length; i++) {
                                    let raceTime = new Date(races[i]['date'] + ' ' + races[i]['time']);
                                    if(raceTime > now) {
                                        console.log('>>>>>>>>>>>>>>>>>', races[i]['raceName']);
                                        newName = races[i]['raceName'];
                                        break;
                                    }
                                }
        
                                appData['sessionName'] = newName;   
                                appData['onGoingSession'] = false;
        
                                io.emit('data', { 
                                    incomingData: false,
                                    sessionName: appData['sessionName']
                                });
                            })
                            .catch((error) => console.log(error));

                        };

                        updateSessionName();
                        

                        

                    }
                } else {
                    appData['onGoingSession'] = true;
                    appData['sessionName'] = (
                        data['R']['SessionInfo']['Meeting']['Name'] +
                        ` (${data['R']['SessionInfo']['Name']})`
                    );
    
                    const topThree = data['R']['TopThree'];

                    if(topThree != undefined) {
                        let topDriver = topThree['Lines'][0];
            
                        const timingData = data['R']['TimingData'];
                        const driversList = data['R']['DriverList'];
                        
                        const ourDriver = 'Max Verstappen';
                        let racingNumber = '';
                        let pitStops = 0;
                        let winning = false;
            
                        Object.keys(driversList).every((number) => {
                            if(driversList[number]['FullName'].toLowerCase() === ourDriver.toLowerCase()) {
                                racingNumber = driversList[number]['RacingNumber'];
                                return false;
                            } 
                            return true;
                        });
            
                        
                        Object.keys(timingData['Lines']).every((line) => {
                            if(timingData['Lines'][line]['RacingNumber'] === racingNumber) {
                                pitStops = timingData['Lines'][line]['NumberOfPitStops'];
                                return false;
                            }
                            return true;
                        });
            
                        
                        winning = (
                            topDriver['RacingNumber'] === racingNumber && 
                            topDriver['FullName'].toLowerCase() === ourDriver.toLowerCase() 
                        );
            
                        console.log(racingNumber, pitStops, winning);
        
                        appData['isWinning'] = winning;
                        appData['pitStops'] = pitStops;
            
                        io.emit('data', {
                            incomingData: true,
                            isWinning: winning,
                            pitStops: pitStops,
                            sessionName: appData['sessionName']
                        });

                    }
                }
            }
		});
	});
	return p;
}


main();

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, '/index.html'));
});

server.listen(port, '0.0.0.0', () => {
    console.log(`listening on *:${port}`);
});

io.on('connection', (socket) => {
    console.log('A user connected.');
    io.emit('data', {
        incomingData: appData['onGoingSession'],
        isWinning: appData['isWinning'],
        pitStops: appData['pitStops'],
        sessionName: appData['sessionName']
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected.');
    })
});