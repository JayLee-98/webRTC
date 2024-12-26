<template>
    <div id="app">
      <h1>WebRTC 화상 채팅</h1>
      <div class="mode-selector">
        <button @click="mode = 'mesh'" :class="{ active: mode === 'mesh' }">Mesh 네트워크 방식</button>
        <button @click="mode = 'sfu'" :class="{ active: mode === 'sfu' }">SFU 네트워크 방식</button>
      </div>
      <VideoChat v-if="mode === 'mesh'" />
      <SfuVideoChat v-else />
    </div>
  </template>
  
  <script>
  import VideoChat from './components/VideoChat.vue'
  import SfuVideoChat from './components/SfuVideoChat.vue'
  
  export default {
    name: 'App',
    components: {
      VideoChat,
      SfuVideoChat
    },
    data() {
      return {
        mode: 'mesh'
      }
    }
  }
  </script>
  
  <style>
  .mode-selector {
    margin-bottom: 20px;
  }
  
  .mode-selector button {
    margin: 0 10px;
    padding: 10px 20px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
  
  .mode-selector button.active {
    background-color: #4CAF50;
    color: white;
  }
  </style>