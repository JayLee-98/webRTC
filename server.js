const express = require('express');
const app = express();
const fs = require('fs');
const path = require('path');
const https = require('https');

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

const PORT = 3000;
const connectedUsers = new Map(); // 연결된 사용자들을 추적하기 위한 Map

io.on('connection', (socket) => {
  connectedUsers.set(socket.id, {
    roomName: null,
    joinTime: new Date().toLocaleTimeString()
  });
  
  console.log(`새 사용자 연결됨 (ID: ${socket.id})`);
  console.log(`현재 연결된 사용자 수: ${connectedUsers.size}`);
  console.log('연결된 모든 사용자:', Array.from(connectedUsers.keys()));

  socket.on('join_room', (roomName) => {
    connectedUsers.get(socket.id).roomName = roomName;
    socket.join(roomName);
    socket.to(roomName).emit('welcome');
    
    console.log(`사용자 ${socket.id}가 룸 ${roomName}에 참가함`);
    // 해당 룸의 모든 사용자 출력
    const roomUsers = Array.from(io.sockets.adapter.rooms.get(roomName) || []);
    console.log(`룸 ${roomName}의 현재 사용자들:`, roomUsers);
  });

  socket.on('offer', (offer, roomName) => {
    console.log(`사용자 ${socket.id}가 룸 ${roomName}에 offer를 보냄`);
    socket.to(roomName).emit('offer', offer);
  });

  socket.on('answer', (answer, roomName) => {
    console.log(`사용자 ${socket.id}가 룸 ${roomName}에 answer를 보냄`);
    socket.to(roomName).emit('answer', answer);
  });

  socket.on('ice', (ice, roomName) => {
    console.log(`사용자 ${socket.id}가 룸 ${roomName}에 ice candidate를 보냄`);
    socket.to(roomName).emit('ice', ice);
  });

  socket.on('disconnect', () => {
    const user = connectedUsers.get(socket.id);
    console.log(`사용자 연결 해제됨 (ID: ${socket.id}, 룸: ${user?.roomName})`);
    connectedUsers.delete(socket.id);
    console.log(`남은 연결된 사용자 수: ${connectedUsers.size}`);
    console.log('남은 사용자들:', Array.from(connectedUsers.keys()));
  });
});

server.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});