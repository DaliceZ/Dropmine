import {
  MAX_BYTES,
  MAX_FILES,
  type ClientMessage,
  type Peer,
  type ServerMessage,
  type Signal,
} from "../../../../shared/protocol";
import type { Snapshot, TransferView } from "../../types/dropmine";
import { isActive } from "../../utils/file";
import { resolveSignalingUrl } from "../../config/signaling";
import {
  loadDeviceName,
  normalizeDeviceName,
  saveDeviceName,
} from "../DeviceNameStore";
const adjectives = ["Mint", "Blue", "Sunny", "Little", "Silver", "Happy"];
const animals = ["Fox", "Otter", "Panda", "Owl", "Rabbit", "Whale"];
function randomName() {
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${animals[Math.floor(Math.random() * animals.length)]} ${Math.floor(Math.random() * 90 + 10)}`;
}

export class Dropmine {
  private state: Snapshot = {
    connected: false,
    name: loadDeviceName() ?? randomName(),
    visible: true,
    selfId: "",
    peers: [],
    pairedIds: [],
    token: "",
    expires: 0,
    transfer: null,
    history: [],
    downloads: [],
    error: "",
  };
  private listeners = new Set<() => void>();
  private socket?: WebSocket;
  private reconnect?: ReturnType<typeof setTimeout>;
  private reconnectDelay = 1000;
  private watchdog?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private peerConnection?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private candidates: RTCIceCandidateInit[] = [];
  private signalQueue: Promise<void> = Promise.resolve();
  private iceServers: RTCIceServer[] = [];
  private outgoing: File[] = [];
  private chunks: ArrayBuffer[] = [];
  private receiveIndex = 0;
  private receiveBytes = 0;
  private totalReceived = 0;
  private waitingCompletion = false;
  private receiving = false;
  private started = 0;
  private lastUpdate = 0;
  private pairToken = "";
  private abort = new AbortController();

  constructor() {
    const fragment = new URLSearchParams(location.hash.slice(1));
    this.pairToken = fragment.get("pair") || "";
    if (this.pairToken)
      history.replaceState(null, "", location.pathname + location.search);
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<Snapshot>) {
    if (patch.transfer) {
      const transfer = patch.transfer;
      if (!isActive(transfer) && !transfer.finishedAt)
        transfer.finishedAt = Date.now();
      patch.history = [
        transfer,
        ...this.state.history.filter((entry) => entry.id !== transfer.id),
      ].sort((first, second) => second.startedAt - first.startedAt);
    }
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private transfer(patch: Partial<TransferView>) {
    if (this.state.transfer)
      this.update({ transfer: { ...this.state.transfer, ...patch } });
  }
  private send(message: ClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN)
      throw new Error("ขาดการเชื่อมต่อกับเซิร์ฟเวอร์");
    this.socket.send(JSON.stringify(message));
  }
  start = () => {
    this.stopped = false;
    this.connect();
  };
  stop = () => {
    this.stopped = true;
    clearTimeout(this.reconnect);
    this.socket?.close();
    this.cleanup();
    this.clearDownloads();
    this.update({ transfer: null, history: [] });
  };
  private connect() {
    if (this.stopped) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(resolveSignalingUrl(import.meta.env.VITE_SIGNALING_URL, location.href, location.protocol === 'https:'));
    } catch {
      this.update({ error: 'ตั้งค่าการเชื่อมต่อไม่ถูกต้อง กรุณาติดต่อผู้ดูแล' });
      return;
    }
    this.socket = socket;
    const connectionTimeout = setTimeout(() => socket.close(), 10_000);
    socket.onopen = () => { clearTimeout(connectionTimeout); this.reconnectDelay = 1000; };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      try {
        this.handle(JSON.parse(event.data) as ServerMessage);
      } catch {
        this.fail("ไม่สามารถประมวลผลข้อมูลการเชื่อมต่อได้");
      }
    };
    socket.onerror = () => {
      socket.close();
    };
    socket.onclose = () => {
      clearTimeout(connectionTimeout);
      if (this.socket !== socket || this.stopped) return;
      if (isActive(this.state.transfer))
        this.fail("การเชื่อมต่อขาด กรุณาส่งใหม่อีกครั้ง", false);
      this.update({
        connected: false,
        peers: [],
        pairedIds: [],
        token: "",
        expires: 0,
      });
      const delay = this.reconnectDelay + Math.random() * 500;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
      this.reconnect = setTimeout(() => this.connect(), delay);
    };
  }
  profile = (name: string, visible: boolean) => {
    this.update({ name: name.trim().slice(0, 40) || this.state.name, visible });
    if (this.state.connected) this.sendProfile();
  };
  rename = (name: string) => {
    const normalized = normalizeDeviceName(name);
    if (!normalized) return false;
    const saved = saveDeviceName(normalized);
    this.profile(normalized, this.state.visible);
    return saved;
  };
  private sendProfile() {
    this.send({
      type: "profile",
      name: this.state.name,
      visible: this.state.visible,
      kind: /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)
        ? "mobile"
        : "desktop",
    });
  }
  rotatePair = () => {
    if (this.state.connected) this.send({ type: "rotate-pair" });
  };
  pair = (text: string) => {
    try {
      let token = text.trim();
      if (token.includes("://")) {
        const url = new URL(token);
        token = new URLSearchParams(url.hash.slice(1)).get("pair") || "";
      }
      if (!/^[\w-]{32}$/.test(token))
        throw new Error("กรุณาวางลิงก์จับคู่ที่ถูกต้อง");
      this.send({ type: "pair", token });
    } catch (error) {
      this.update({ error: (error as Error).message });
    }
  };
  clearError = () => this.update({ error: "" });
  clearDownloads = () => {
    this.state.downloads.forEach((download) =>
      URL.revokeObjectURL(download.url),
    );
    this.update({ downloads: [] });
  };
  request = (peer: Peer, files: File[]) => {
    if (isActive(this.state.transfer))
      return this.update({ error: "กรุณารอให้รายการปัจจุบันเสร็จก่อน" });
    if (
      !files.length ||
      files.length > MAX_FILES ||
      files.reduce((total, file) => total + file.size, 0) > MAX_BYTES
    )
      return this.update({
        error: "เลือกได้สูงสุด 50 ไฟล์ ขนาดรวมไม่เกิน 200 MB ต่อครั้ง",
      });
    this.cleanup();
    this.clearDownloads();
    this.outgoing = files;
    const id = crypto.randomUUID
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) =>
          value.toString(16).padStart(2, "0"),
        ).join("");
    const metadata = files.map((file) => ({
      name: file.name,
      size: file.size,
    }));
    this.update({
      error: "",
      transfer: {
        id,
        peer,
        files: metadata,
        direction: "send",
        stage: "waiting",
        bytes: 0,
        speed: 0,
        detail: "รอผู้รับยอมรับไฟล์",
        startedAt: Date.now(),
      },
    });
    try {
      this.send({ type: "request", target: peer.id, id, files: metadata });
      this.armTimeout(70_000);
    } catch (error) {
      this.fail((error as Error).message);
    }
  };
  respond = (accept: boolean) => {
    const transfer = this.state.transfer;
    if (
      !transfer ||
      transfer.direction !== "receive" ||
      transfer.stage !== "waiting"
    )
      return;
    try {
      this.send({ type: "respond", id: transfer.id, accept });
    } catch (error) {
      this.fail((error as Error).message);
    }
  };
  cancel = () => {
    const transfer = this.state.transfer;
    if (!transfer || !isActive(transfer)) return;
    try {
      this.send({ type: "cancel", id: transfer.id });
    } catch {
      this.update({ connected: false });
    }
    this.cleanup();
    this.clearDownloads();
    this.transfer({ stage: "cancelled", detail: "ยกเลิกการส่งแล้ว" });
  };
  private handle(message: ServerMessage) {
    if (message.type === "hello") {
      this.iceServers = message.iceServers;
      this.update({
        connected: true,
        selfId: message.self.id,
        token: message.token,
        expires: message.expires,
      });
      this.sendProfile();
      if (this.pairToken) {
        this.send({ type: "pair", token: this.pairToken });
        this.pairToken = "";
      }
    } else if (message.type === "peers") this.update({ peers: message.peers });
    else if (message.type === "pair-token")
      this.update({ token: message.token, expires: message.expires });
    else if (message.type === "paired")
      this.update({
        pairedIds: [...new Set([...this.state.pairedIds, message.peer.id])],
        error: "",
      });
    else if (message.type === "incoming") {
      if (isActive(this.state.transfer)) {
        this.send({ type: "respond", id: message.id, accept: false });
        return;
      }
      this.cleanup();
      this.clearDownloads();
      this.update({
        error: "",
        transfer: {
          id: message.id,
          peer: message.peer,
          files: message.files,
          direction: "receive",
          stage: "waiting",
          bytes: 0,
          speed: 0,
          detail: "มีไฟล์ส่งถึงคุณ",
          startedAt: Date.now(),
        },
      });
      this.armTimeout(70_000);
    } else if (
      message.type === "accepted" &&
      message.id === this.state.transfer?.id
    ) {
      this.transfer({ stage: "connecting", detail: "กำลังเชื่อมต่อโดยตรง…" });
      void this.createPeer(message.initiator).catch((error) =>
        this.fail((error as Error).message),
      );
    } else if (
      message.type === "signal" &&
      message.id === this.state.transfer?.id
    ) {
      this.signalQueue = this.signalQueue
        .then(() => this.signal(message.signal))
        .catch(() => this.fail("เชื่อมต่ออุปกรณ์ไม่ได้ กรุณาลองใหม่"));
    } else if (
      message.type === "ended" &&
      message.id === this.state.transfer?.id
    ) {
      const details = {
        complete:
          this.state.transfer.direction === "send"
            ? "ผู้รับได้รับไฟล์ครบแล้ว"
            : "รับไฟล์ครบแล้ว กดบันทึกไฟล์ด้านล่าง",
        declined: "ผู้รับปฏิเสธไฟล์",
        cancelled: "ยกเลิกการส่งแล้ว",
        disconnected: "อีกอุปกรณ์ออกจากเว็บ กรุณาส่งใหม่",
        timeout: "หมดเวลารอ กรุณาลองอีกครั้ง",
      };
      this.cleanup();
      if (message.reason !== "complete") this.clearDownloads();
      this.transfer({
        stage:
          message.reason === "complete"
            ? "complete"
            : message.reason === "declined"
              ? "declined"
              : message.reason === "cancelled"
                ? "cancelled"
                : "failed",
        detail: details[message.reason],
      });
    } else if (message.type === "error") {
      if (
        message.id &&
        message.id === this.state.transfer?.id &&
        isActive(this.state.transfer)
      )
        this.fail(message.message, false);
      else this.update({ error: message.message });
    }
  }
  private async createPeer(initiator: boolean) {
    if (!("RTCPeerConnection" in window))
      throw new Error(
        "เบราว์เซอร์นี้ไม่รองรับ WebRTC กรุณาใช้ Chrome หรือ Safari รุ่นใหม่",
      );
    const connection = new RTCPeerConnection({ iceServers: this.iceServers });
    this.peerConnection = connection;
    this.abort = new AbortController();
    this.started = performance.now();
    this.armTimeout(30_000);
    const id = this.state.transfer!.id;
    connection.onicecandidate = (event) => {
      if (event.candidate && this.peerConnection === connection) {
        try {
          this.send({
            type: "signal",
            id,
            signal: { candidate: event.candidate.toJSON() },
          });
        } catch {
          this.fail("ขาดการเชื่อมต่อ");
        }
      }
    };
    connection.onconnectionstatechange = () => {
      if (
        this.peerConnection === connection &&
        ["failed", "disconnected"].includes(connection.connectionState)
      )
        this.fail("เชื่อมต่อโดยตรงไม่ได้ ตรวจสอบ Wi-Fi หรือ VPN แล้วลองใหม่");
    };
    connection.ondatachannel = (event) =>
      this.setupChannel(event.channel, false);
    if (initiator) {
      this.setupChannel(
        connection.createDataChannel("files", { ordered: true }),
        true,
      );
      await connection.setLocalDescription(await connection.createOffer());
      if (this.peerConnection === connection)
        this.send({
          type: "signal",
          id,
          signal: { description: connection.localDescription!.toJSON() },
        });
    }
  }
  private async signal(signal: Signal) {
    const connection = this.peerConnection;
    const id = this.state.transfer?.id;
    if (!connection || !id) return;
    if ("description" in signal) {
      await connection.setRemoteDescription(signal.description);
      if (connection !== this.peerConnection) return;
      for (const candidate of this.candidates.splice(0))
        await connection.addIceCandidate(candidate);
      if (signal.description.type === "offer") {
        await connection.setLocalDescription(await connection.createAnswer());
        if (connection === this.peerConnection)
          this.send({
            type: "signal",
            id,
            signal: { description: connection.localDescription!.toJSON() },
          });
      }
    } else if (connection.remoteDescription)
      await connection.addIceCandidate(signal.candidate);
    else this.candidates.push(signal.candidate);
  }
  private setupChannel(channel: RTCDataChannel, sending: boolean) {
    this.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 256 * 1024;
    channel.onopen = () => {
      this.started = performance.now();
      this.transfer({
        stage: "transferring",
        detail: sending ? "กำลังส่งไฟล์…" : "กำลังรับไฟล์…",
      });
      this.armTimeout();
      if (sending)
        void this.sendFiles(channel).catch((error) => {
          if (this.channel === channel && !this.abort.signal.aborted)
            this.fail((error as Error).message);
        });
    };
    channel.onmessage = (event) => {
      if (sending || this.channel !== channel) return;
      try {
        this.receive(event.data);
      } catch {
        this.fail("ไฟล์ที่ได้รับไม่ครบหรือข้อมูลไม่ถูกต้อง กรุณาส่งใหม่");
      }
    };
    channel.onerror = () => {
      if (this.channel === channel) this.fail("การส่งไฟล์มีปัญหา กรุณาลองใหม่");
    };
    channel.onclose = () => {
      if (
        this.channel === channel &&
        isActive(this.state.transfer) &&
        !this.waitingCompletion
      )
        this.fail("การเชื่อมต่อไฟล์ถูกปิดก่อนเสร็จ");
    };
  }
  private async capacity(channel: RTCDataChannel, signal: AbortSignal) {
    if (signal.aborted || channel.readyState !== "open")
      throw new Error("การส่งถูกยกเลิก");
    if (channel.bufferedAmount < 1024 * 1024) return;
    await new Promise<void>((resolveCapacity, reject) => {
      const clean = () => {
        channel.removeEventListener("bufferedamountlow", ready);
        channel.removeEventListener("close", closed);
        signal.removeEventListener("abort", closed);
      };
      const ready = () => {
        clean();
        resolveCapacity();
      };
      const closed = () => {
        clean();
        reject(new Error("การเชื่อมต่อถูกปิด"));
      };
      channel.addEventListener("bufferedamountlow", ready, { once: true });
      channel.addEventListener("close", closed, { once: true });
      signal.addEventListener("abort", closed, { once: true });
    });
  }
  private async sendFiles(channel: RTCDataChannel) {
    const signal = this.abort.signal;
    let total = 0;
    for (const [index, file] of this.outgoing.entries()) {
      await this.capacity(channel, signal);
      channel.send(JSON.stringify({ type: "file-start", index }));
      for (let offset = 0; offset < file.size; offset += 16 * 1024) {
        await this.capacity(channel, signal);
        const buffer = await file
          .slice(offset, offset + 16 * 1024)
          .arrayBuffer();
        if (signal.aborted) return;
        channel.send(buffer);
        total += buffer.byteLength;
        this.progress(total);
      }
      await this.capacity(channel, signal);
      channel.send(JSON.stringify({ type: "file-end", index }));
    }
    await this.capacity(channel, signal);
    channel.send(JSON.stringify({ type: "all-end" }));
    this.waitingCompletion = true;
    this.progress(total, true);
    this.transfer({ detail: "ส่งข้อมูลครบแล้ว กำลังรอผู้รับยืนยัน…" });
  }
  private receive(data: string | ArrayBuffer) {
    const transfer = this.state.transfer!;
    this.armTimeout();
    if (typeof data !== "string") {
      const file = transfer.files[this.receiveIndex];
      if (
        !this.receiving ||
        !file ||
        !(data instanceof ArrayBuffer) ||
        this.receiveBytes + data.byteLength > file.size
      )
        throw new Error();
      this.chunks.push(data);
      this.receiveBytes += data.byteLength;
      this.totalReceived += data.byteLength;
      this.progress(this.totalReceived);
      return;
    }
    const message = JSON.parse(data);
    if (
      message.type === "file-start" &&
      !this.receiving &&
      message.index === this.receiveIndex &&
      transfer.files[this.receiveIndex]
    ) {
      this.receiving = true;
      this.chunks = [];
      this.receiveBytes = 0;
    } else if (
      message.type === "file-end" &&
      this.receiving &&
      message.index === this.receiveIndex &&
      this.receiveBytes === transfer.files[this.receiveIndex].size
    ) {
      const file = transfer.files[this.receiveIndex];
      const blob = new Blob(this.chunks, { type: "application/octet-stream" });
      this.update({
        downloads: [
          ...this.state.downloads,
          { ...file, url: URL.createObjectURL(blob) },
        ],
      });
      this.chunks = [];
      this.receiving = false;
      this.receiveIndex++;
    } else if (
      message.type === "all-end" &&
      !this.receiving &&
      this.receiveIndex === transfer.files.length
    ) {
      this.waitingCompletion = true;
      this.progress(
        transfer.files.reduce((total, file) => total + file.size, 0),
        true,
      );
      this.send({ type: "complete", id: transfer.id });
    } else throw new Error();
  }
  private progress(bytes: number, force = false) {
    this.armTimeout();
    const speed =
      bytes / Math.max((performance.now() - this.started) / 1000, 0.1);
    if (force || performance.now() - this.lastUpdate > 100) {
      this.lastUpdate = performance.now();
      this.transfer({ bytes, speed });
    }
  }
  private armTimeout(duration = 90_000) {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(
      () => this.fail("หมดเวลารอการเชื่อมต่อ กรุณาตรวจสอบเครือข่ายแล้วส่งใหม่"),
      duration,
    );
  }
  private fail(detail: string, notify = true) {
    const transfer = this.state.transfer;
    if (notify && isActive(transfer)) {
      try {
        this.send({ type: "cancel", id: transfer!.id });
      } catch {
        this.update({ connected: false });
      }
    }
    this.cleanup();
    this.clearDownloads();
    if (transfer && isActive(transfer))
      this.transfer({ stage: "failed", detail });
    else this.update({ error: detail });
  }
  private cleanup() {
    clearTimeout(this.watchdog);
    this.abort.abort();
    const channel = this.channel;
    const connection = this.peerConnection;
    this.channel = undefined;
    this.peerConnection = undefined;
    channel?.close();
    connection?.close();
    this.candidates = [];
    this.signalQueue = Promise.resolve();
    this.chunks = [];
    this.outgoing = [];
    this.receiveIndex = 0;
    this.receiveBytes = 0;
    this.totalReceived = 0;
    this.waitingCompletion = false;
    this.receiving = false;
  }
}
