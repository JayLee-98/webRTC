<!-- VideoChat.vue -->

<template>
    <div class="video-chat">
      <div class="room-controls" v-if="!isInRoom">
        <input v-model="roomId" placeholder="룸 ID 입력" />
        <button @click="initCall">룸 참가</button>
      </div>
      
      <div v-if="isInRoom" class="video-container">
        <!-- ref 이름이 myFace인지 확인 -->
        <div class="video-wrapper">
          <video ref="myFace" autoplay playsinline muted></video>
        </div>
        <div class="video-wrapper">
          <video ref="peerFace" autoplay playsinline></video>
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

export default {
  name: 'VideoChat',
  data() {
    return {
      socket: null,
      roomId: '',
      myStream: null,
      peerConnection: null,
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
  methods: {
    async initCall() {
  if (!this.roomId) {
    alert('룸 ID를 입력해주세요.');
    return;
  }

  try {
    this.isInRoom = true;  // 먼저 상태 변경
    await this.$nextTick();  // DOM 업데이트 대기
    await this.getMedia();   // 미디어 접근 시도
    this.makeConnection();
    this.socket.emit('join_room', this.roomId);
  } catch (error) {
    console.error('통화 초기화 에러:', error);
    this.isInRoom = false;  // 에러 발생 시 상태 복구
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

    // nextTick을 사용하여 DOM 업데이트 후 실행
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

    async getCameras() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter(device => device.kind === "videoinput");
        const currentCamera = this.myStream.getVideoTracks()[0];
        
        this.cameras = cameras;
        
        if (currentCamera && cameras.length > 0) {
          this.selectedCamera = cameras.find(
            camera => camera.label === currentCamera.label
          )?.deviceId;
        }
      } catch (error) {
        console.error('카메라 목록 가져오기 에러:', error);
      }
    },

    async switchCamera() {
      await this.getMedia(this.selectedCamera);
      if (this.peerConnection) {
        const videoTrack = this.myStream.getVideoTracks()[0];
        const videoSender = this.peerConnection
          .getSenders()
          .find(sender => sender.track.kind === "video");
        videoSender.replaceTrack(videoTrack);
      }
    },

    makeConnection() {
      this.peerConnection = new RTCPeerConnection(this.configuration);
      
      this.peerConnection.onicecandidate = (data) => {
        console.log("sent candidate");
        this.socket.emit("ice", data.candidate, this.roomId);
      };
      
      this.peerConnection.ontrack = (data) => {
        console.log("Got stream from peer");
        this.$refs.peerFace.srcObject = data.streams[0];
      };
      
      // Add local stream tracks to peer connection
      this.myStream.getTracks().forEach((track) => {
        this.peerConnection.addTrack(track, this.myStream);
      });
    },

    initSocketEvents() {
      this.socket.on("welcome", async () => {
        console.log("someone joined");
        const offer = await this.peerConnection.createOffer();
        this.peerConnection.setLocalDescription(offer);
        console.log("sent the offer");
        this.socket.emit("offer", offer, this.roomId);
      });

      this.socket.on("offer", async (offer) => {
        console.log("received the offer");
        this.peerConnection.setRemoteDescription(offer);
        const answer = await this.peerConnection.createAnswer();
        this.peerConnection.setLocalDescription(answer);
        this.socket.emit("answer", answer, this.roomId);
        console.log("sent the answer");
      });

      this.socket.on("answer", (answer) => {
        console.log("received the answer");
        this.peerConnection.setRemoteDescription(answer);
      });

      this.socket.on("ice", (ice) => {
        console.log("received candidate");
        this.peerConnection.addIceCandidate(ice);
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
      if (this.peerConnection) {
        this.peerConnection.close();
      }
      this.isInRoom = false;
      this.roomId = '';
      this.myStream = null;
      this.peerConnection = null;
      
      // 새로운 연결 생성
      this.socket = io('http://localhost:3000');
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