// sfu-server.js
const express = require('express');
const app = express();
const fs = require('fs');
const path = require('path');
const https = require('https');
const mediasoup = require('mediasoup');

const options = {
  key: fs.readFileSync(path.resolve(__dirname, 'localhost+1-key.pem')),
  cert: fs.readFileSync(path.resolve(__dirname, 'localhost+1.pem'))
};

const server = https.createServer(options, app);
const io = require('socket.io')(server, {
  cors: {
    origin: ["https://192.168.0.74:5173", "https://localhost:5173"],
    methods: ["GET", "POST"]
  }
});

const PORT = 4000;

let worker;
let router;
let producerTransports = new Map();
let consumerTransports = new Map();
let producers = new Map();
let consumers = new Map();

const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000
    }
  }
];

async function createWorker() {
  worker = await mediasoup.createWorker({
    logLevel: 'debug',
    logTags: [
      'info',
      'ice',
      'dtls',
      'rtp',
      'srtp',
      'rtcp',
    ],
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
  });
  
  console.log(`mediasoup worker pid: ${worker.pid}`);

  worker.on('died', error => {
    console.error('mediasoup worker died', error);
    setTimeout(() => process.exit(1), 2000);
  });

  return worker;
}

async function createWebRtcTransport() {
  const transport = await router.createWebRtcTransport({
    listenIps: [
      {
        ip: '0.0.0.0',
        announcedIp: '192.168.0.74' // 서버의 실제 IP
      }
    ],
    initialAvailableOutgoingBitrate: 1000000,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });

  transport.on('dtlsstatechange', dtlsState => {
    if (dtlsState === 'closed') {
      transport.close();
    }
  });

  transport.on('close', () => {
    console.log('transport closed');
  });

  return transport;
}

(async () => {
  try {
    worker = await createWorker();
    router = await worker.createRouter({ mediaCodecs });
    console.log('Router created');

    io.on('connection', async socket => {
      console.log('client connected', socket.id);

      // RTP Capabilities 요청 처리
      socket.on('getRouterRtpCapabilities', (callback) => {
        callback({ routerRtpCapabilities: router.rtpCapabilities });
      });

      // Producer Transport 생성 요청 처리
      socket.on('createProducerTransport', async (callback) => {
        try {
          const transport = await createWebRtcTransport();
          producerTransports.set(socket.id, transport);
          
          callback({
            params: {
              id: transport.id,
              iceParameters: transport.iceParameters,
              iceCandidates: transport.iceCandidates,
              dtlsParameters: transport.dtlsParameters,
            }
          });
        } catch (error) {
          console.error('createProducerTransport error:', error);
          callback({ error: error.message });
        }
      });

      // Producer Transport 연결 요청 처리
      socket.on('connectProducerTransport', async ({ dtlsParameters }, callback) => {
        try {
          const transport = producerTransports.get(socket.id);
          await transport.connect({ dtlsParameters });
          callback({ success: true });
        } catch (error) {
          console.error('connectProducerTransport error:', error);
          callback({ error: error.message });
        }
      });

      // Producer 생성 요청 처리
      socket.on('transport-produce', async ({ kind, rtpParameters, appData }, callback) => {
        try {
          const transport = producerTransports.get(socket.id);
          const producer = await transport.produce({
            kind,
            rtpParameters,
            appData: {
              socketId: socket.id,
              ...appData
            }
          });
      
          producer.on('score', (score) => {
            console.log('producer score:', score);
          });
      
          producer.observer.on('close', () => {
            console.log('producer closed');
            producers.delete(producer.id);
          });
      
          producers.set(producer.id, producer);
          console.log(`Producer created with id: ${producer.id}`);
      
          callback({ id: producer.id });
      
          // 다른 사용자들에게 새 producer 알림
          socket.broadcast.emit('new-producer', {
            producerId: producer.id,
            socketId: socket.id
          });
        } catch (error) {
          console.error('transport-produce error:', error);
          callback({ error: error.message });
        }
      });

      // Consumer Transport 생성 요청 처리
      socket.on('createConsumerTransport', async (callback) => {
        try {
          const transport = await createWebRtcTransport();
          consumerTransports.set(socket.id, transport);
          
          callback({
            params: {
              id: transport.id,
              iceParameters: transport.iceParameters,
              iceCandidates: transport.iceCandidates,
              dtlsParameters: transport.dtlsParameters,
            }
          });
        } catch (error) {
          console.error('createConsumerTransport error:', error);
          callback({ error: error.message });
        }
      });

      // Consumer Transport 연결 요청 처리
      socket.on('connectConsumerTransport', async ({ transportId, dtlsParameters }, callback) => {
        try {
          const transport = consumerTransports.get(socket.id);
          await transport.connect({ dtlsParameters });
          callback({ success: true });
        } catch (error) {
          console.error('connectConsumerTransport error:', error);
          callback({ error: error.message });
        }
      });

      // Consumer 생성 요청 처리
      socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
        try {
          if (!router.canConsume({ producerId, rtpCapabilities })) {
            throw new Error('can not consume');
          }
          const transport = consumerTransports.get(socket.id);
          const consumer = await transport.consume({
            producerId,
            rtpCapabilities,
            paused: true,  // producer가 일시 중지된 상태로 시작
          });

          consumer.on('transportclose', () => {
            console.log('consumer transport closed');
          });

          consumer.on('producerclose', () => {
            console.log('consumer producer closed');
            consumer.close();
            consumers.delete(consumer.id);
          });

          consumers.set(consumer.id, consumer);
          await consumer.resume(); // consumer 재개

          callback({
            consumerParams: {
              id: consumer.id,
              producerId,
              kind: consumer.kind,
              rtpParameters: consumer.rtpParameters,
              type: consumer.type,
              producerPaused: consumer.producerPaused
            }
          });
        } catch (error) {
          console.error('consume error:', error);
          callback({ error: error.message });
        }
      });

      // 연결 해제 처리
      socket.on('disconnect', () => {
        console.log('client disconnected', socket.id);
        
        // Producer Transport 정리
        const producerTransport = producerTransports.get(socket.id);
        if (producerTransport) {
          producerTransport.close();
          producerTransports.delete(socket.id);
        }

        // Consumer Transport 정리
        const consumerTransport = consumerTransports.get(socket.id);
        if (consumerTransport) {
          consumerTransport.close();
          consumerTransports.delete(socket.id);
        }

        // Producer와 Consumer 정리
        producers.forEach((producer, id) => {
          if (producer.appData.socketId === socket.id) {
            producer.close();
            producers.delete(id);
          }
        });

        consumers.forEach((consumer, id) => {
          if (consumer.appData.socketId === socket.id) {
            consumer.close();
            consumers.delete(id);
          }
        });
      });
    });

  } catch (error) {
    console.error('Failed to create worker:', error);
    process.exit(1);
  }
})();

server.listen(PORT, () => {
  console.log(`SFU 서버가 포트 ${PORT}에서 실행 중입니다.`);
});