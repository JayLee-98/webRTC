<!-- SfuVideoChat.vue -->
<template>
    <div class="video-chat">
      <div class="room-controls" v-if="!isInRoom">
        <input v-model="roomId" placeholder="룸 ID 입력" />
        <button @click="initCall">룸 참가</button>
      </div>
      
      <div v-if="isInRoom" class="video-container">
        <div class="video-wrapper">
          <video ref="myFace" autoplay playsinline muted></video>
          <p>내 비디오</p>
        </div>
        <div v-for="[consumerId, stream] in consumerStreams" :key="consumerId" class="video-wrapper">
          <video :ref="`consumer_${consumerId}`" autoplay playsinline></video>
          <p>참가자 비디오</p>
        </div>
      </div>
  
      <div class="controls" v-if="isInRoom">
        <button @click="toggleCamera">카메라 {{ isCameraOn ? '끄기' : '켜기' }}</button>
        <button @click="toggleMic">마이크 {{ isMicOn ? '끄기' : '켜기' }}</button>
        <button @click="leaveRoom" class="leave-btn">나가기</button>
      </div>
    </div>
  </template>
  
  <script>
  import { io } from 'socket.io-client';
  import * as mediasoupClient from 'mediasoup-client';
  
  export default {
    name: 'SfuVideoChat',
    data() {
      return {
        socket: null,
        roomId: '',
        device: null,
        producerTransport: null,
        consumerTransports: new Map(),
        producers: new Map(),
        consumers: new Map(),
        consumerStreams: new Map(),
        myStream: null,
        isInRoom: false,
        isCameraOn: true,
        isMicOn: true,
      }
    },
  
    async created() {
      this.socket = io('https://192.168.0.74:4000', {
        transports: ['websocket'],
        secure: true
      });
      this.device = new mediasoupClient.Device();
      this.initSocketEvents();
    },
  
    methods: {
      async initCall() {
        if (!this.roomId) {
          alert('룸 ID를 입력해주세요.');
          return;
        }
  
        try {
          await this.getMedia();
          this.isInRoom = true;
          
          // Router의 RTP Capabilities 가져오기
          await new Promise((resolve) => {
            this.socket.emit('getRouterRtpCapabilities', async (response) => {
              console.log('Got RTP Capabilities:', response);
              await this.device.load({ routerRtpCapabilities: response.routerRtpCapabilities });
              resolve();
            });
          });
  
          // Producer Transport 생성
          await new Promise((resolve) => {
            this.socket.emit('createProducerTransport', async (response) => {
              console.log('Producer transport created:', response);
              this.producerTransport = this.device.createSendTransport(response.params);
              resolve();
            });
          });
  
          // Producer Transport 이벤트 설정
          this.producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            try {
              this.socket.emit('connectProducerTransport', { dtlsParameters }, (response) => {
                console.log('Producer transport connected:', response);
                if (response.error) {
                  errback(response.error);
                } else {
                  callback();
                }
              });
            } catch (error) {
              errback(error);
            }
          });
  
          this.producerTransport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
  try {
    const data = {
      kind,
      rtpParameters,
      appData: {
        ...appData,
        socketId: this.socket.id
      }
    };
    
    this.socket.emit('transport-produce', data, (response) => {
      if (response.error) {
        errback(response.error);
      } else {
        callback({ id: response.id });
      }
    });
  } catch (error) {
    console.error('Produce error:', error);
    errback(error);
  }
});
          // 스트림 전송
          const videoTrack = this.myStream.getVideoTracks()[0];
          const audioTrack = this.myStream.getAudioTracks()[0];
  
// 스트림 전송
if (videoTrack) {
  console.log('Producing video track');
  const videoProducer = await this.producerTransport.produce({
    track: videoTrack,
    encodings: [
      { maxBitrate: 100000, scaleResolutionDownBy: 4 },
      { maxBitrate: 300000, scaleResolutionDownBy: 2 },
      { maxBitrate: 900000 }
    ],
    codecOptions: {
      videoGoogleStartBitrate: 1000
    },
    codec: this.device.rtpCapabilities.codecs.find(codec => codec.mimeType.toLowerCase() === 'video/vp8')
  });
  this.producers.set('video', videoProducer);
}

if (audioTrack) {
  console.log('Producing audio track');
  const audioProducer = await this.producerTransport.produce({
    track: audioTrack,
    codecOptions: {
      opusStereo: 1,
      opusDtx: 1
    }
  });
  this.producers.set('audio', audioProducer);
}

          console.log('Joining room:', this.roomId);
          this.socket.emit('join_room', this.roomId);
  
        } catch (error) {
          console.error('통화 초기화 에러:', error);
          this.isInRoom = false;
          alert('통화 연결에 실패했습니다.');
        }
      },
  
      async getMedia() {
        try {
          this.myStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: { facingMode: "user" }
          });
  
          this.$nextTick(() => {
            const videoElement = this.$refs.myFace;
            if (videoElement) {
              videoElement.srcObject = this.myStream;
            }
          });
        } catch (error) {
          console.error('미디어 접근 에러:', error);
          throw error;
        }
      },
  
      initSocketEvents() {
        this.socket.on('connect', () => {
          console.log('Socket connected');
        });
  
        this.socket.on('disconnect', () => {
          console.log('Socket disconnected');
        });
  
        this.socket.on('error', (error) => {
          console.error('Socket error:', error);
        });
  
        // 새로운 Producer 알림 수신
        this.socket.on('new-producer', async ({ producerId }) => {
          try {
            console.log('New producer detected:', producerId);
            // Consumer Transport 생성
            const transportResponse = await new Promise((resolve) => {
              this.socket.emit('createConsumerTransport', (response) => {
                console.log('Consumer transport created:', response);
                resolve(response);
              });
            });
  
            const consumerTransport = this.device.createRecvTransport(transportResponse.params);
            this.consumerTransports.set(producerId, consumerTransport);
  
            // Consumer Transport 연결
            consumerTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
              this.socket.emit('connectConsumerTransport', {
                transportId: consumerTransport.id,
                dtlsParameters
              }, (response) => {
                console.log('Consumer transport connected:', response);
                if (response.error) {
                  errback(response.error);
                } else {
                  callback();
                }
              });
            });
  
            // Consumer 생성
            const { rtpCapabilities } = this.device;
            const consumeResponse = await new Promise((resolve) => {
              this.socket.emit('consume', {
                producerId,
                rtpCapabilities
              }, (response) => {
                console.log('Consume response:', response);
                resolve(response);
              });
            });
  
            const consumer = await consumerTransport.consume(consumeResponse.consumerParams);
            this.consumers.set(consumer.id, consumer);
            
            const stream = new MediaStream([consumer.track]);
            this.consumerStreams.set(consumer.id, stream);
  
            this.$nextTick(() => {
              const videoElement = this.$refs[`consumer_${consumer.id}`]?.[0];
              if (videoElement) {
                videoElement.srcObject = stream;
              }
            });
  
          } catch (error) {
            console.error('Consumer 생성 에러:', error);
          }
        });
      },
  
      toggleCamera() {
        this.myStream
          .getVideoTracks()
          .forEach((track) => (track.enabled = !track.enabled));
        this.isCameraOn = !this.isCameraOn;
      },
  
      toggleMic() {
        this.myStream
          .getAudioTracks()
          .forEach((track) => (track.enabled = !track.enabled));
        this.isMicOn = !this.isMicOn;
      },
  
      leaveRoom() {
        if (this.socket) {
          this.socket.disconnect();
        }
  
        if (this.myStream) {
          this.myStream.getTracks().forEach(track => track.stop());
        }
  
        // Producer, Consumer 정리
        this.producers.forEach(producer => {
          producer.close();
        });
        this.consumers.forEach(consumer => {
          consumer.close();
        });
  
        // Transport 정리
        if (this.producerTransport) {
          this.producerTransport.close();
        }
        this.consumerTransports.forEach(transport => {
          transport.close();
        });
  
        // Map 초기화
        this.producers.clear();
        this.consumers.clear();
        this.consumerStreams.clear();
        this.consumerTransports.clear();
        
        // 상태 초기화
        this.isInRoom = false;
        this.roomId = '';
        this.myStream = null;
        this.producerTransport = null;
        
        // 새로운 연결 생성
        this.socket = io('https://192.168.0.74:4000', {
          transports: ['websocket'],
          secure: true
        });
        this.device = new mediasoupClient.Device();
        this.initSocketEvents();
      }
    },
  
    beforeUnmount() {
      this.leaveRoom();
    }
  }
  </script>
  
  <style scoped>
  .video-chat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    padding: 20px;
  }
  
  .room-controls {
    display: flex;
    gap: 10px;
  }
  
  .video-container {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    justify-content: center;
  }
  
  .video-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  
  video {
    width: 400px;
    height: 300px;
    border: 1px solid #ccc;
    border-radius: 8px;
    background-color: #f0f0f0;
  }
  
  select {
    width: 100%;
    max-width: 400px;
    padding: 8px;
    border-radius: 4px;
    border: 1px solid #ccc;
  }
  
  .controls {
    display: flex;
    gap: 10px;
  }
  
  button {
    padding: 10px 20px;
    border: none;
    border-radius: 4px;
    background-color: #4CAF50;
    color: white;
    cursor: pointer;
  }
  
  button:hover {
    background-color: #45a049;
  }
  
  .leave-btn {
    background-color: #f44336;
  }
  
  .leave-btn:hover {
    background-color: #da190b;
  }
  
  input {
    padding: 10px;
    border: 1px solid #ccc;
    border-radius: 4px;
  }
  </style>