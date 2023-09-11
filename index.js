const express = require("express");
const axios = require('axios');
const path = require('path');
const ws = require('ws');

const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

const port = process.env.PORT || 3000;
app.use(express.static(__dirname + '/public'));

let appData = {
    onGoingSession: null,
    sessionName: null
};

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

		sock.on('open', ev => {
			res(sock);
		});
		sock.on('message', (data) => {
			console.log('received %s', data);
            data = JSON.parse(data);

            if(Object.keys(data).length === 0) {
                if(appData['onGoingSession'] === true || appData['onGoingSession'] === null) {
                    appData['sessionName'] = "Waiting for data..";
                    axios.get("https://ergast.com/api/f1/current/next.json")
                    .then((response) => {
                        let data = response.data;
                        appData['sessionName'] = data['MRData']['RaceTable']['Races'][0]['raceName'];
                        console.log('here');
                    })
                    .catch((error) => console.log(error));
                }

                appData['onGoingSession'] = false;

                io.emit('data', { 
                    incomingData: false,
                    sessionName: appData['sessionName']
                });
            } else if(data.hasOwnProperty('R')) {
                appData['onGoingSession'] = true;
                appData['sessionName'] = data['R']['SessionInfo']['Meeting']['Name'];

                const topThree = data['R']['TopThree'];
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
      
                console.log(racingNumber);
                console.log(pitStops);
                console.log(winning);
      
                io.emit('data', {
                    incomingData: true,
                    isWinning: winning,
                    pitStops: pitStops,
                    sessionName: appData['sessionName']
                });
            }
		});
	});
	return p
}

async function main() {
	try {
		const resp = await negotiate();

		console.log(resp.data);
		console.log(resp.headers);
		const sock = await connectwss(resp.data['ConnectionToken'], resp.headers['set-cookie']);

		sock.send(JSON.stringify(
			{
				"H": "Streaming",
				"M": "Subscribe",
				"A": [["SessionInfo", "DriverList", "TopThree", "TimingData"]],
				"I": 1
			}
		));
	} catch(e) {
		console.error(e);
	}
}

main();

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, '/index.html'));
});

server.listen(port, '0.0.0.0', () => {
    console.log(`listening on *:${port}`);
});