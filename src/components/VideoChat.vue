<!-- VideoChat.vue -->
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
        <template v-for="[peerId, stream] in Array.from(peerStreams.entries())" :key="peerId">
          <div class="video-wrapper">
            <video :ref="`peerFace_${peerId}`" autoplay playsinline></video>
            <p>참가자 비디오 ({{ peerId }})</p>
          </div>
        </template>
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
  
  export default {
    name: 'VideoChat',
    data() {
      return {
        socket: null,
        roomId: '',
        myStream: null,
        peerConnections: new Map(),
        peerStreams: new Map(),
        isInRoom: false,
        isCameraOn: true,
        isMicOn: true,
        cameras: [],
        selectedCamera: null,
        configuration: {
          iceServers: [
            {
              urls: [
                "stun:stun.l.google.com:19302",
                "stun:stun1.l.google.com:19302",
                "stun:stun2.l.google.com:19302",
                "stun:stun3.l.google.com:19302",
                "stun:stun4.l.google.com:19302",
              ],
            },
          ],
        }
      }
    },
    created() {
      this.socket = io('https://192.168.0.74:3000', {
        transports: ['websocket'],
        secure: true
      });
      this.initSocketEvents();
    },
    async mounted() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        console.log('사용 가능한 장치들:', devices);
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        console.log('사용 가능한 카메라:', videoDevices);
      } catch (error) {
        console.error('장치 목록 조회 실패:', error);
      }
    },
    watch: {
      peerStreams: {
        deep: true,
        handler(newVal) {
          console.log('PeerStreams updated:', Array.from(newVal.entries()));
          this.$forceUpdate();
        }
      }
    },
    updated() {
      this.peerStreams.forEach((stream, peerId) => {
        const videoEl = this.$refs[`peerFace_${peerId}`]?.[0];
        if (videoEl && !videoEl.srcObject) {
          console.log('Updating video element for peer:', peerId);
          videoEl.srcObject = stream;
        }
      });
    },
    methods: {
      async initCall() {
        if (!this.roomId) {
          alert('룸 ID를 입력해주세요.');
          return;
        }
  
        try {
          this.isInRoom = true;
          await this.$nextTick();
          await this.getMedia();
          this.socket.emit('join_room', this.roomId);
        } catch (error) {
          console.error('통화 초기화 에러:', error);
          this.isInRoom = false;
          alert('카메라를 시작할 수 없습니다. 카메라 권한을 확인해주세요.');
        }
      },
  
      async getMedia(deviceId) {
        try {
          const initialConstraints = {
            audio: true,
            video: { facingMode: "user" }
          };
          
          console.log('미디어 접근 시도 시작');
          this.myStream = await navigator.mediaDevices.getUserMedia(initialConstraints);
          console.log('스트림 획득 성공');
  
          this.$nextTick(() => {
            const videoElement = this.$refs.myFace;
            if (videoElement) {
              videoElement.srcObject = this.myStream;
              console.log('비디오 요소에 스트림 설정 완료');
            } else {
              console.error('비디오 요소를 찾을 수 없음');
            }
          });
  
        } catch (error) {
          console.error('미디어 접근 에러:', error);
          throw error;
        }
      },
  
      async makeConnection(peerId) {
        const peerConnection = new RTCPeerConnection(this.configuration);
        
        peerConnection.onicecandidate = (event) => {
          if (event.candidate) {
            console.log("Sending ice candidate to:", peerId);
            this.socket.emit("ice", {
              candidate: event.candidate,
              peerId: peerId
            }, this.roomId);
          }
        };
        
        peerConnection.ontrack = (event) => {
          console.log("Got track from:", peerId);
          this.peerStreams.set(peerId, event.streams[0]);
          
          this.$nextTick(() => {
            const videoEl = this.$refs[`peerFace_${peerId}`]?.[0];
            if (videoEl && event.streams[0]) {
              console.log('Setting stream for peer:', peerId);
              videoEl.srcObject = event.streams[0];
            } else {
              console.error('Video element not found for peer:', peerId);
            }
          });
        };
  
        this.myStream.getTracks().forEach(track => {
          peerConnection.addTrack(track, this.myStream);
        });
  
        this.peerConnections.set(peerId, peerConnection);
        return peerConnection;
      },
  
      initSocketEvents() {
        this.socket.on("user_enter", async (userId) => {
          console.log("New user entered:", userId);
          const peerConnection = await this.makeConnection(userId);
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);
          this.socket.emit("offer", {
            offer,
            peerId: userId
          }, this.roomId);
        });
  
        this.socket.on("offer", async ({ offer, peerId }) => {
          console.log("Received offer from:", peerId);
          const peerConnection = await this.makeConnection(peerId);
          await peerConnection.setRemoteDescription(offer);
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          this.socket.emit("answer", {
            answer,
            peerId
          }, this.roomId);
        });
  
        this.socket.on("answer", async ({ answer, peerId }) => {
          console.log("Received answer from:", peerId);
          const peerConnection = this.peerConnections.get(peerId);
          if (peerConnection) {
            await peerConnection.setRemoteDescription(answer);
          }
        });
  
        this.socket.on("ice", async ({ candidate, peerId }) => {
          console.log("Received ICE candidate from:", peerId);
          const peerConnection = this.peerConnections.get(peerId);
          if (peerConnection) {
            await peerConnection.addIceCandidate(candidate);
          }
        });
  
        this.socket.on("user_exit", (userId) => {
          console.log("User left:", userId);
          if (this.peerConnections.has(userId)) {
            this.peerConnections.get(userId).close();
            this.peerConnections.delete(userId);
          }
          this.peerStreams.delete(userId);
          this.$forceUpdate();
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
        this.peerConnections.forEach(connection => {
          connection.close();
        });
        this.peerConnections.clear();
        this.peerStreams.clear();
        
        this.isInRoom = false;
        this.roomId = '';
        this.myStream = null;
        
        this.socket = io('https://192.168.0.74:3000', {
          transports: ['websocket'],
          secure: true
        });
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