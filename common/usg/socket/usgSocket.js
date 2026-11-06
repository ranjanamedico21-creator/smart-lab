/**
 * Thin wrapper around your existing Socket.IO instance so services can push
 * live status updates to the USG Worklist / Review dashboards without
 * importing `io` everywhere directly.
 *
 * In your main app bootstrap:
 *   const { initUsgSocket } = require('./src/socket/usgSocket');
 *   initUsgSocket(io); // io = your existing Socket.IO server instance
 */

let ioInstance = null;

function initUsgSocket(io) {
  ioInstance = io;
  const nsp = io.of('/usg');
  nsp.on('connection', (socket) => {
    socket.on('subscribe:study', (studyId) => socket.join(`study:${studyId}`));
    socket.on('subscribe:worklist', () => socket.join('worklist'));
  });
}

function emitStatus(event, payload) {
  if (!ioInstance) return; // socket not initialized (e.g. during tests) — no-op
  const nsp = ioInstance.of('/usg');
  nsp.to('worklist').emit(event, payload);
  if (payload.studyId) nsp.to(`study:${payload.studyId}`).emit(event, payload);
}

module.exports = { initUsgSocket, emitStatus };
