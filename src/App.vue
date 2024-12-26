<template>
    <div id="app">
      <h1>WebRTC 화상 채팅</h1>
      <VideoChat />
    </div>
  </template>
  
  <script>
  import VideoChat from './components/VideoChat.vue'
  
  export default {
    name: 'App',
    components: {
      VideoChat
    }
  }
  </script>