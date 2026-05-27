import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { doc, setDoc, updateDoc, onSnapshot, getDoc } from "firebase/firestore";
import { db } from "./firebase";

const FOODS = [
  { id: "agua", name: "Agua", icon: "💧", effect: "No pasa nada" },
  { id: "helado", name: "Helado", icon: "🍦", effect: "Elige a quién kikear" },
  { id: "zanahoria", name: "Zanahoria", icon: "🥕", effect: "Pierdes / kik" },
  { id: "azar", name: "Azar", icon: "🎲", effect: "Bolas cazadoras, pierdes si te toca" },
];

const ROLES = ["Dueño", "Guía", "Jugador"];

const ROLE_ICONS = {
  Dueño: "👑",
  Guía: "🛡️",
  Jugador: "🎮",
};

const HABBO_BOTS = [
  "Sefos",
  "arturo",
  "xx.Mike.xx",
  "DaniTheBoss",
  "HabboAlex",
  "Ceick",
  "RetroBoy",
  "SirJona",
  "NicoHabbo",
  "SofiCute",
  "DarkPlayer",
  "LauGamer",
  "TomyRetro",
  "FerPixel",
  "MaxRoom",
  "IrisHabbo",
  "KaiPlayer",
  "ZoeRetro",
  "LeoHabbo",
  "SamPixel",
];

function random(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function makeLocalUserId() {
  const saved = localStorage.getItem("zk_user_id");
  if (saved) return saved;

  const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  localStorage.setItem("zk_user_id", id);
  return id;
}

function makeRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export default function App() {
  const localUserId = useRef(makeLocalUserId());

  const [players, setPlayers] = useState([]);
  const [turn, setTurn] = useState(0);
  const [seconds, setSeconds] = useState(12);
  const timerLock = useRef(false);

  const [item, setItem] = useState(null);
  const [drawing, setDrawing] = useState(false);
  const [waitingKickSelection, setWaitingKickSelection] = useState(false);

  const [role, setRole] = useState("Jugador");
  const isAdmin = role === "Dueño" || role === "Guía";

  const [message, setMessage] = useState("¡Saca un objeto de la nevera!");
  const [chatInput, setChatInput] = useState("");
  const [chat, setChat] = useState([]);
  const [log, setLog] = useState(["Sala abierta. Jugadores sentados alrededor de la nevera."]);

  const [showRoomModal, setShowRoomModal] = useState(true);
  const [roomSize, setRoomSize] = useState(6);
  const [habboName, setHabboName] = useState("");
  const [testMode, setTestMode] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);

  const [winner, setWinner] = useState(null);
  const [loser, setLoser] = useState(null);

  const [roomId, setRoomId] = useState("");
  const [shareUrl, setShareUrl] = useState("");

  const activePlayers = players.filter((p) => p.active);
  const currentPlayer = activePlayers[turn % Math.max(activePlayers.length, 1)];

  const currentPlayerIsBot = currentPlayer?.isBot;
  const isMyTurn = currentPlayer?.id === localUserId.current;
  const canResolveHelado = item?.id === "helado" && isMyTurn && !currentPlayer?.isBot;

  const seats = useMemo(() => {
    const startX = 5;
    const startY = 28;
    const gapX = 20;
    const gapY = 30;
    const columns = 5;

    return players.map((p, i) => {
      const col = i % columns;
      const row = Math.floor(i / columns);

      return {
        ...p,
        x: startX + col * gapX,
        y: startY + row * gapY,
      };
    });
  }, [players]);

  async function updateRoom(patch) {
    if (!roomId) return;
    await updateDoc(doc(db, "rooms", roomId), patch);
  }

  function setLocalAndRemote(patch) {
    if (patch.players) setPlayers(patch.players);
    if (typeof patch.turn === "number") setTurn(patch.turn);
    if ("item" in patch) setItem(patch.item);
    if (patch.log) setLog(patch.log);
    if (patch.chat) setChat(patch.chat);
    if ("message" in patch) setMessage(patch.message);
    if ("winner" in patch) setWinner(patch.winner);
    updateRoom(patch).catch(console.error);
  }

  function addLog(text) {
    const nextLog = [text, ...log].slice(0, 8);
    setLog(nextLog);
    updateRoom({ log: nextLog }).catch(console.error);
  }

  function nextTurnFromPlayers(nextPlayers = players) {
    const alive = nextPlayers.filter((p) => p.active);
    if (alive.length <= 1) return turn;

    const nextTurn = (turn + 1) % alive.length;
    setSeconds(12);
    setTurn(nextTurn);
    updateRoom({ turn: nextTurn }).catch(console.error);

    return nextTurn;
  }

  function kickPlayer(id, reason) {
    const victim = players.find((p) => p.id === id);
    if (!victim) return;

    const nextPlayers = players.map((p) =>
      p.id === id ? { ...p, active: false } : p
    );

    const alive = nextPlayers.filter((p) => p.active);
    const nextLog = [`${victim.name} fue kikeado: ${reason}.`, ...log].slice(0, 8);

    const patch = {
      players: nextPlayers,
      item: null,
      log: nextLog,
    };

    setWaitingKickSelection(false);
    setDrawing(false);

    if (victim.id === localUserId.current) {
      setLoser(victim);
    }

    if (alive.length === 1) {
      patch.winner = alive[0];
      patch.message = `🏆 ${alive[0].name} gana la ronda.`;
      patch.turn = 0;
    } else {
      patch.turn = (turn + 1) % alive.length;
      patch.message = message;
    }

    setLocalAndRemote(patch);
  }

  function drawObject() {
    if (!currentPlayer || activePlayers.length <= 1 || drawing) return;
    if (!currentPlayer.isBot && !isMyTurn) return;

    setDrawing(true);
    setItem(null);
    setMessage(`${currentPlayer.name} está abriendo la nevera...`);

    setTimeout(() => {
      const result = random(FOODS.filter((food) => food.id !== "azar"));
      const nextPlayers = players.map((p) =>
        p.id === currentPlayer.id ? { ...p, lastItem: result } : p
      );

      let nextLog = [`${currentPlayer.name} sacó ${result.name}.`, ...log].slice(0, 8);
      let nextTurn = turn;
      let nextMessage = "";
      let nextItem = result;

      setDrawing(false);
      setPlayers(nextPlayers);
      setItem(result);

      if (result.id === "agua") {
        nextMessage = "💧 Agua: no pasa nada. Pasa el siguiente jugador.";
        nextTurn = (turn + 1) % nextPlayers.filter((p) => p.active).length;
        setWaitingKickSelection(false);
      }

      if (result.id === "helado") {
        nextMessage = "🍦 Helado: elige un jugador para kikear.";
        setWaitingKickSelection(true);
      }

      if (result.id === "zanahoria") {
        nextMessage = "🥕 Zanahoria: pierdes y sales de la ronda.";
        setWaitingKickSelection(false);

        setLocalAndRemote({
          players: nextPlayers,
          item: result,
          log: nextLog,
          message: nextMessage,
        });

        setTimeout(() => kickPlayer(currentPlayer.id, "sacó zanahoria"), 500);
        return;
      }

      setLocalAndRemote({
        players: nextPlayers,
        item: nextItem,
        log: nextLog,
        message: nextMessage,
        turn: nextTurn,
      });
    }, 900);
  }

  function azar() {
    if (!currentPlayer || activePlayers.length <= 1) return;
    if (!canResolveHelado) return;

    setWaitingKickSelection(false);
    setDrawing(false);
    setItem(null);

    const nextLog = [`${currentPlayer.name} activó AZAR.`, ...log].slice(0, 8);
    setLog(nextLog);
    setMessage("🎲 AZAR: bolas cazadoras activadas...");

    setTimeout(() => {
      const possibleVictims = activePlayers.filter((p) => p.id !== currentPlayer.id);
      const victim = random(possibleVictims);

      if (!victim) return;

      const finalLog = [
        `${victim.name} fue alcanzado por las bolas cazadoras.`,
        ...nextLog,
      ].slice(0, 8);

      setLog(finalLog);
      updateRoom({ log: finalLog }).catch(console.error);
      kickPlayer(victim.id, "azar");
    }, 850);
  }

  async function createOnlineRoom(roomPlayers) {
    const newRoomId = makeRoomId();
    const url = `${window.location.origin}/room/${newRoomId}`;

    await setDoc(doc(db, "rooms", newRoomId), {
      roomId: newRoomId,
      ownerId: roomPlayers[0].id,
      players: roomPlayers,
      turn: 0,
      item: null,
      log: ["Sala creada."],
      chat: [],
      message: "¡Saca un objeto de la nevera!",
      winner: null,
      createdAt: Date.now(),
    });

    setRoomId(newRoomId);
    setShareUrl(url);
    window.history.pushState(null, "", `/room/${newRoomId}`);
  }

  async function joinOnlineRoom(joinRoomId, player) {
    const roomRef = doc(db, "rooms", joinRoomId);
    const snap = await getDoc(roomRef);

    if (!snap.exists()) {
      alert("La sala no existe.");
      return;
    }

    const data = snap.data();
    const currentPlayers = data.players || [];

    const alreadyInside = currentPlayers.some((p) => p.id === player.id);
    const nextPlayers = alreadyInside ? currentPlayers : [...currentPlayers, player];

    await updateDoc(roomRef, {
      players: nextPlayers,
      log: [`${player.name} entró a la sala.`, ...(data.log || [])].slice(0, 8),
    });

    setRoomId(joinRoomId);
    setShareUrl(`${window.location.origin}/room/${joinRoomId}`);
    setRole("Jugador");
    setShowRoomModal(false);
  }

  useEffect(() => {
    const pathRoomId = window.location.pathname.split("/room/")[1];
    if (!pathRoomId) return;

    setRoomId(pathRoomId);
    setShareUrl(`${window.location.origin}/room/${pathRoomId}`);
    setShowRoomModal(true);

    const unsub = onSnapshot(doc(db, "rooms", pathRoomId), (snap) => {
      if (!snap.exists()) return;

      const room = snap.data();

      setPlayers(room.players || []);
      setTurn(room.turn || 0);
      setItem(room.item || null);
      setLog(room.log || []);
      setChat(room.chat || []);
      setMessage(room.message || "¡Saca un objeto de la nevera!");
      setWinner(room.winner || null);

      const me = (room.players || []).find((p) => p.id === localUserId.current);
      if (me?.isOwner) setRole("Dueño");
      else if (me) setRole("Jugador");
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!roomId) return;

    const unsub = onSnapshot(doc(db, "rooms", roomId), (snap) => {
      if (!snap.exists()) return;

      const room = snap.data();

      setPlayers(room.players || []);
      setTurn(room.turn || 0);
      setItem(room.item || null);
      setLog(room.log || []);
      setChat(room.chat || []);
      setMessage(room.message || "¡Saca un objeto de la nevera!");
      setWinner(room.winner || null);
    });

    return () => unsub();
  }, [roomId]);

  useEffect(() => {
    if (!currentPlayer || activePlayers.length <= 1 || item?.id === "helado" || winner) return;

    setSeconds(12);

    const timer = setInterval(() => {
      setSeconds((prev) => {
        if (prev <= 1) {
          if (!timerLock.current) {
            timerLock.current = true;

            const nextTurn = (turn + 1) % activePlayers.length;
            setTurn(nextTurn);
            updateRoom({ turn: nextTurn }).catch(console.error);

            setTimeout(() => {
              timerLock.current = false;
            }, 200);
          }

          return 12;
        }

        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [currentPlayer?.id, item?.id, activePlayers.length, winner, turn]);

  useEffect(() => {
    if (!currentPlayer?.isBot) return;
    if (drawing) return;
    if (item?.id === "helado") return;
    if (activePlayers.length <= 1) return;
    if (winner) return;

    const botTimer = setTimeout(() => {
      drawObject();
    }, 1200);

    return () => clearTimeout(botTimer);
  }, [currentPlayer?.id, drawing, item?.id, activePlayers.length, winner]);

  useEffect(() => {
    if (!currentPlayer?.isBot) return;
    if (item?.id !== "helado") return;
    if (winner) return;

    const botKickTimer = setTimeout(() => {
      const victims = activePlayers.filter((p) => p.id !== currentPlayer.id);
      const victim = random(victims);

      if (!victim) return;

      addLog(`${currentPlayer.name} eligió al azar a ${victim.name} con helado.`);
      kickPlayer(victim.id, "elegido por bot con helado");
    }, 1400);

    return () => clearTimeout(botKickTimer);
  }, [currentPlayer?.id, item?.id, activePlayers.length, winner]);

  async function createRoom(e) {
    e.preventDefault();

    const pathRoomId = window.location.pathname.split("/room/")[1];

    const ownerPlayer = {
      id: localUserId.current,
      name: habboName || "Dueño",
      habboName,
      look: null,
      active: true,
      lastItem: null,
      isOwner: !pathRoomId,
      isBot: false,
    };

    if (pathRoomId) {
      await joinOnlineRoom(pathRoomId, {
        ...ownerPlayer,
        isOwner: false,
      });
      return;
    }

    if (testMode) {
      const bots = Array.from({ length: Number(roomSize) - 1 }, (_, i) => {
        const botHabbo = HABBO_BOTS[i % HABBO_BOTS.length];

        return {
          id: `bot-${i + 1}`,
          name: botHabbo,
          habboName: botHabbo,
          look: null,
          active: true,
          lastItem: null,
          isBot: true,
        };
      });

      const roomPlayers = [ownerPlayer, ...bots];

      setPlayers(roomPlayers);
      setRole("Dueño");
      setAiEnabled(true);
      setShowRoomModal(false);
      await createOnlineRoom(roomPlayers);
      return;
    }

    setPlayers([ownerPlayer]);
    setRole("Dueño");
    setAiEnabled(false);
    setShowRoomModal(false);
    await createOnlineRoom([ownerPlayer]);
  }

  async function leaveRoom(playerId) {
    const nextPlayers = players.filter((p) => p.id !== playerId);

    setPlayers(nextPlayers);

    if (roomId) {
      await updateRoom({
        players: nextPlayers,
        log: [`${players.find((p) => p.id === playerId)?.name || "Un jugador"} salió de la sala.`, ...log].slice(0, 8),
      });
    }

    if (playerId === localUserId.current) {
      setShowRoomModal(true);
      setRole("Jugador");
    }
  }

  function reset() {
    const nextPlayers = players.map((p) => ({
      ...p,
      active: true,
      lastItem: null,
    }));

    const patch = {
      players: nextPlayers,
      turn: 0,
      item: null,
      winner: null,
      message: "¡Saca un objeto de la nevera!",
      log: ["Juego reiniciado. Los jugadores siguen en la sala."],
    };

    setSeconds(12);
    setDrawing(false);
    setWinner(null);
    setLoser(null);
    setWaitingKickSelection(false);
    setLocalAndRemote(patch);
  }

  async function sendChat(e) {
    e.preventDefault();

    const text = chatInput.trim();
    if (!text) return;

    const nextChat = [`${ROLE_ICONS[role]} ${habboName || role}: ${text}`, ...chat].slice(0, 8);
    setChatInput("");
    setChat(nextChat);
    updateRoom({ chat: nextChat }).catch(console.error);

    if (text.toLowerCase() === "azar" && isAdmin) {
      azar();
    }
  }

  return (
    <div className="zk-page">
      <style>{css}</style>

      {showRoomModal && (
        <div className="modal-backdrop">
          <form className="room-modal" onSubmit={createRoom}>
            <h2>{roomId ? "Unirse a sala" : "Crear sala"}</h2>

            <label>
              Nombre Habbo
              <input
                value={habboName}
                onChange={(e) => setHabboName(e.target.value)}
                placeholder="russia-1994"
                required
              />
            </label>

            {!roomId && (
              <>
                <label>
                  Tamaño de sala
                  <select
                    value={roomSize}
                    onChange={(e) => setRoomSize(Number(e.target.value))}
                  >
                    <option value={6}>6 jugadores</option>
                    <option value={10}>10 jugadores</option>
                    <option value={20}>20 jugadores</option>
                  </select>
                </label>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={testMode}
                    onChange={(e) => setTestMode(e.target.checked)}
                  />
                  <span>¿Partida de prueba?</span>
                </label>
              </>
            )}

            <button type="submit">{roomId ? "Unirme" : "Crear sala"}</button>
          </form>
        </div>
      )}

      {winner && (
        <div className="winner-backdrop">
          <motion.div
            className="winner-modal"
            initial={{ scale: 0.4, opacity: 0, rotate: -8 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
          >
            <div className="confetti">🎉 🎊 ✨ 🎉</div>
            <h2>¡Ganador!</h2>
            <img
              className="winner-avatar"
              src={
                winner.look
                  ? `https://www.habbo.es/habbo-imaging/avatarimage?figure=${winner.look}&direction=2&head_direction=3&size=l`
                  : `https://www.habbo.es/habbo-imaging/avatarimage?user=${winner.habboName}&direction=2&head_direction=3&size=l`
              }
              alt={winner.name}
            />
            <h3>{winner.name}</h3>

            {isAdmin && <button onClick={reset}>Nueva partida</button>}
          </motion.div>
        </div>
      )}

      {loser && !winner && (
        <div className="loser-backdrop">
          <motion.div
            className="loser-modal"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
          >
            <h2>Has perdido</h2>

            <img
              className="winner-avatar"
              src={
                loser.look
                  ? `https://www.habbo.es/habbo-imaging/avatarimage?figure=${loser.look}&direction=2&head_direction=3&size=l`
                  : `https://www.habbo.es/habbo-imaging/avatarimage?user=${loser.habboName}&direction=2&head_direction=3&size=l`
              }
              alt={loser.name}
            />

            <h3>{loser.name}</h3>

            <button onClick={() => setLoser(null)}>Cerrar</button>
          </motion.div>
        </div>
      )}

      <header className="zk-header">
        <div className="logo">ZK</div>
        <div>
          <h1>Zana Kik — prototipo web</h1>
          <p>Versión sin apuestas ni premios reales. Solo mecánica de ronda.</p>
          {shareUrl && (
            <p className="share-url">
              Link de sala: <button onClick={() => navigator.clipboard.writeText(shareUrl)}>Copiar invitación</button>
            </p>
          )}
        </div>
        <button
          className="danger"
          onClick={() => currentPlayer && leaveRoom(localUserId.current)}
        >
          Abandonar sala
        </button>
      </header>

      <main className="zk-grid">
        <aside className="side-panel">
          {role !== "Dueño" && role !== "Guía" && <h3>Bienvenidos</h3>}

          {role !== "Jugador" && (
            <div>
              <h3>ZONA DEL DUEÑO / GUÍA</h3>
              <p className="muted">Rol actual</p>
              <h2>{ROLE_ICONS[role]} {role}</h2>
              <button
                onClick={() => {
                  const index = ROLES.indexOf(role);
                  setRole(ROLES[(index + 1) % ROLES.length]);
                }}
              >
                Cambiar rol
              </button>
            </div>
          )}

          <div className="divider" />
          <h3>Jugadores ({activePlayers.length})</h3>

          <div className="player-list">
            {players.map((p) => (
              <div key={p.id} className={`player-row ${p.active ? "" : "dead"}`}>
                <span>{p.isBot ? "🤖" : "🧍"}</span>
                <b>{p.name}</b>
                {currentPlayer?.id === p.id && p.active ? <em>Turno</em> : <i />}
              </div>
            ))}
          </div>
        </aside>

        <section className="room-card">
          <div className="room-toolbar" style={{ justifyContent: "center" }}>
            <h1 style={{ textAlign: "center" }}>BIENVENIDO A ZANA KIK</h1>
          </div>

          <div className="turn-pill" style={{ justifyContent: "center", marginBottom: "12px" }}>
            <span>{currentPlayer?.isBot ? "🤖" : "🧍"}</span>
            <b>Turno de: {currentPlayer?.name || "—"}</b>
            <em>⏱ {seconds}s</em>
          </div>

          <div className="room">
            <div className="window"><span /> <span /></div>
            <div className="neon">ZANA KIK</div>
            <div className="floor" />

            {seats.filter((p) => p.active).map((p) => (
              <motion.div
                key={p.id}
                className={`seat ${currentPlayer?.id === p.id ? "current" : ""}`}
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                animate={currentPlayer?.id === p.id && p.active ? { y: [0, -8, 0] } : { y: 0 }}
                transition={{ duration: 1.1, repeat: currentPlayer?.id === p.id && p.active ? Infinity : 0 }}
              >
                {p.lastItem && <div className="avatar-item">{p.lastItem.icon}</div>}

                <div/>

                <img
                  className="habbo-avatar"
                  src={
                    p.look
                      ? `https://www.habbo.es/habbo-imaging/avatarimage?figure=${p.look}&direction=2&head_direction=3&size=l`
                      : `https://www.habbo.es/habbo-imaging/avatarimage?user=${p.habboName}&direction=2&head_direction=3&size=l`
                  }
                  alt={p.name}
                />

                <label>{p.name}</label>
              </motion.div>
            ))}

            <div className="speech">{message}</div>

            <motion.div
              className="fridge"
              animate={drawing ? { rotate: [0, -2, 2, 0], scale: [1, 1.04, 1] } : {}}
              transition={{ duration: 0.3, repeat: drawing ? Infinity : 0 }}
              style={{ marginTop: "20px" }}
            >
              <div className="fridge-side" />
              <div className="fridge-front">
                <div className="freezer">🗄️</div>

                <div className="shelves-row">
                  <div className="shelf">💧</div>
                  <div className="shelf">🍦</div>
                  <div className="shelf">🥕</div>
                </div>

                <div className="handle" />
              </div>

            </motion.div>

            <div className="main-controls">
              <button
                className="main-draw"
                onClick={drawObject}
                disabled={
                  drawing ||
                  item?.id === "helado" ||
                  activePlayers.length <= 1 ||
                  currentPlayerIsBot ||
                  !isMyTurn
                }
              >
                {currentPlayerIsBot
                  ? "TURNO DEL BOT"
                  : !isMyTurn
                    ? "ESPERA TU TURNO"
                    : drawing
                      ? "SACANDO..."
                      : "SACAR OBJETO"}
              </button>

              <button
                className="secondary-btn"
                onClick={azar}
                disabled={!canResolveHelado}
              >
                {canResolveHelado ? "ELEGIR AL “AZAR”" : "AZAR BLOQUEADO"}
              </button>

              {isAdmin && (
                <button className="secondary-btn" onClick={reset}>
                  REINICIAR LA SALA
                </button>
              )}
            </div>
          </div>

          <div className="bottom-cards">
            <div className="mini-card">
              <h3>Reglas rápidas de los objetos</h3>
              <div className="food-row">
                {FOODS.map((f) => (
                  <div key={f.id}>
                    <span>{f.icon}</span>
                    <b>{f.name}</b>
                    <small>{f.effect}</small>
                  </div>
                ))}
              </div>
            </div>

            <div className="mini-card log">
              <h3>Historial / Registro</h3>
              {log.map((entry, i) => <p key={i}>{entry}</p>)}
            </div>
          </div>
        </section>

        <aside className="right-panel">
          <div className="card azar-card">
            <h3>Acción especial: AZAR</h3>
            <p>Escribe en el chat: <b>azar 🎲</b></p>
          </div>

          <div className="card chat">
            <h3>Chat de la sala</h3>

            {chat.map((line, i) => (
              <p key={i}>{line}</p>
            ))}

            <form className="chat-input" onSubmit={sendChat}>
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Escribe algo..."
              />

              <button type="submit">➜</button>
            </form>
          </div>

          {canResolveHelado && (
            <div className="card victims">
              <h3>Elige víctima</h3>

              {activePlayers
                .filter((p) => p.id !== currentPlayer?.id)
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => kickPlayer(p.id, "elegido por helado")}
                  >
                    {p.isBot ? "🤖" : "🧍"} {p.name}
                  </button>
                ))}
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

const css = `
* { box-sizing: border-box; }
body { margin: 0; background: #09051f; color: white; font-family: Inter, system-ui, Arial, sans-serif; }
button { cursor: pointer; border: 0; color: white; font-weight: 800; }
button:disabled { opacity: .45; cursor: not-allowed; }
.zk-page { min-height: 100vh; background: radial-gradient(circle at top, #2b0d58 0%, #08051b 55%, #050414 100%); padding: 18px; }
.zk-header { min-height: 88px; display: grid; grid-template-columns: 74px 1fr 190px; gap: 18px; align-items: center; border-bottom: 1px solid #4e2475; }
.logo { width: 58px; height: 58px; display: grid; place-items: center; border-radius: 14px; background: linear-gradient(135deg, #ff7a00, #ffd43b); color: #651b00; font-size: 27px; font-weight: 1000; box-shadow: 0 0 22px #ff3b8d55; }
h1 { margin: 0; font-size: 30px; }
.zk-header p, .muted { margin: 6px 0 0; color: #c7badc; }
.share-url button { margin-left: 8px; padding: 7px 10px; border-radius: 7px; background: #2469c7; }
.turn-pill { height: 58px; border: 1px solid #843bb3; background: #140a34; border-radius: 12px; display: flex; gap: 18px; align-items: center; justify-content: space-around; box-shadow: inset 0 0 24px #6b1ca633; }
.turn-pill span { font-size: 32px; }
.turn-pill b { color: #ff6bd6; font-size: 18px; }
.turn-pill em { color: #ffe159; font-style: normal; font-weight: 900; }
.danger { background: linear-gradient(135deg, #e03b8a, #b72869); height: 50px; border-radius: 10px; font-size: 16px; }
.zk-grid { display: grid; grid-template-columns: 270px minmax(720px, 1fr) 270px; gap: 16px; padding-top: 16px; }
.side-panel, .card, .mini-card { background: linear-gradient(180deg, #160c3a, #0c0829); border: 1px solid #68299b; border-radius: 10px; box-shadow: 0 0 28px #0006; }
.side-panel { padding: 16px; }
h3 { margin: 0 0 14px; color: #ff58cd; }
.side-panel h2 { color: #ffd51e; font-size: 18px; }
.side-panel button, .room-toolbar button, .victims button { width: 100%; padding: 12px; margin: 6px 0; border-radius: 7px; background: linear-gradient(135deg, #2469c7, #204a9b); }
.divider { height: 1px; background: #47266e; margin: 18px -16px; }
.player-row { display: grid; grid-template-columns: 30px 1fr 58px; align-items: center; height: 33px; }
.player-row em { color: #1a1230; background: #ffd71b; border-radius: 7px; padding: 4px 8px; font-style: normal; font-size: 12px; font-weight: 900; }
.player-row i { width: 8px; height: 8px; background: #4bdd60; border-radius: 50%; justify-self: end; }
.player-row.dead { opacity: .35; text-decoration: line-through; }
.room-card { min-width: 0; }
.room-toolbar { display: flex; gap: 6px; margin-bottom: 10px; }
.room { position: relative; height: 660px; overflow: hidden; border: 1px solid #392579; border-radius: 10px; background: linear-gradient(145deg, #26377a 0 18%, #c34b9d 18% 44%, #9b57bb 44%); box-shadow: inset 0 -80px 90px #09051f88; }
.floor { position: absolute; inset: 150px 70px 40px; transform: perspective(700px) rotateX(58deg) rotateZ(45deg); background-color: #c191d2; background-image: linear-gradient(#7c5c9c 2px, transparent 2px), linear-gradient(90deg, #7c5c9c 2px, transparent 2px); background-size: 42px 42px; box-shadow: 0 18px 0 #22164b; }
.window { position: absolute; left: 28px; top: 85px; width: 170px; height: 105px; background: #101c55; border: 8px solid #281547; transform: skewY(-17deg); display: flex; gap: 14px; padding: 16px;}
.window span { flex: 1; background: linear-gradient(#061542, #102672); border: 2px solid #3656a9; }
.neon { position: absolute; right: 40px; top: 28px; font-size: 32px; font-weight: 900; color: #ff7b00; text-shadow: 0 0 6px #ff7b00aa, 0 0 12px #ff7b00aa, 0 0 18px #ff7b00aa; }
.seat { position: absolute; display: flex; flex-direction: column; align-items: center; gap: 6px; z-index: 10; }
.chair { width: 42px; height: 22px; background: linear-gradient(135deg, #4e2475, #2b0d58); border-radius: 6px; }
.seat label { font-size: 12px; background: #0008; padding: 2px 6px; border-radius: 999px; }
.seat.current .chair { background: linear-gradient(135deg, #ff6bd6, #ff3b8d); box-shadow: 0 0 12px #ff3b8d88; }
.habbo-avatar { width: 72px; image-rendering: pixelated; filter: drop-shadow(0 6px 2px #0008); }
.avatar-item { position: absolute; top: -28px; background: #140a34; border: 2px solid #ff58cd; border-radius: 999px; padding: 4px 8px; font-size: 20px; box-shadow: 0 0 12px #ff58cd88; }
.speech { position: absolute; left: 34%; top: 95px; z-index: 20; background: white; color: #111; padding: 12px; border-radius: 10px; border: 3px solid #111; font-weight: 900; }
.fridge { position: absolute; left: 50%; top: 255px; z-index: 15; transform: translateX(-50%); }
.fridge-front { width: 170px; min-height: 170px; background: linear-gradient(#c9efff, #70b8ed); border: 5px solid #193a65; border-radius: 8px; padding: 12px; box-shadow: 0 22px 30px #0008; }
.fridge-side { position: absolute; right: -22px; top: 18px; width: 34px; height: 138px; background: #69aee5; transform: skewY(-28deg); border: 4px solid #193a65; }
.freezer { height: 42px; text-align: center; font-size: 32px; border-bottom: 4px solid #193a65; }
.shelves-row { display: flex; flex-direction: row; justify-content: center; align-items: center; gap: 12px; margin-top: 18px; }
.shelf { width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; font-size: 32px; background: rgba(255,255,255,.18); border: 2px solid #4a80ad; border-radius: 10px; }
.handle { position: absolute; right: 10px; top: 70px; width: 7px; height: 70px; background: #193a65; border-radius: 999px; }
.item-pop { position: absolute; left: 73%; top: 50%; transform: translate(-50%, -50%); background: linear-gradient(135deg, #ff7a00, #ffd43b); color: #651b00; padding: 12px 18px; border-radius: 10px; display: flex; align-items: center; gap: 12px; font-size: 18px; font-weight: 900; box-shadow: 0 0 22px #ff3b8d55; }
.main-controls { position: absolute; left: 50%; bottom: 45px; transform: translateX(-50%); z-index: 20; display: flex; gap: 12px; align-items: center; }
.main-draw, .secondary-btn { background: linear-gradient(135deg, #2469c7, #204a9b); padding: 14px 22px; font-size: 16px; border-radius: 10px; }
.secondary-btn { background: linear-gradient(135deg, #6b3bc4, #44207e); }
.bottom-cards { display: flex; gap: 16px; margin-top: 16px; }
.mini-card { flex: 1; padding: 12px; }
.food-row { display: flex; flex-direction: column; gap: 8px; }
.food-row div { display: flex; align-items: center; gap: 12px; }
.food-row small { margin-left: auto; color: #c7badc; }
.card { padding: 16px; }
.chat p, .log p { margin: 6px 0; color: #ddd; }
.chat-input { display: flex; gap: 6px; margin-top: 12px; }
.chat-input input { flex: 1; padding: 10px; border-radius: 7px; border: 1px solid #4e2475; background: #21144c; color: white; }
.chat-input button { background: #4e2475; padding: 10px 16px; border-radius: 7px; }
.modal-backdrop, .winner-backdrop, .loser-backdrop { position: fixed; inset: 0; background: #000b; display: grid; place-items: center; z-index: 9999; }
.room-modal, .winner-modal, .loser-modal { width: 380px; background: linear-gradient(180deg, #2b0d58, #10072b); border: 2px solid #68299b; border-radius: 18px; padding: 24px; text-align: center; box-shadow: 0 0 50px #000; }
.room-modal label { display: grid; gap: 6px; text-align: left; margin-bottom: 14px; }
.room-modal input, .room-modal select { padding: 12px; border-radius: 8px; border: 1px solid #4e2475; background: #21144c; color: white; }
.room-modal button, .winner-modal button, .loser-modal button { width: 100%; padding: 14px; border-radius: 10px; background: linear-gradient(135deg, #2469c7, #204a9b); }
.checkbox-row { display: flex !important; align-items: center; gap: 10px; flex-direction: row; }
.checkbox-row input { width: 18px; height: 18px; margin: 0; }
.winner-modal { border-color: #ffd43b; box-shadow: 0 0 50px #ffd43b88; }
.winner-modal h2 { color: #ffd43b; font-size: 38px; }
.loser-modal { border-color: #ff3b8d; box-shadow: 0 0 50px #ff3b8d88; }
.loser-modal h2 { color: #ff5b9f; font-size: 36px; }
.winner-avatar { width: 120px; image-rendering: pixelated; filter: drop-shadow(0 0 18px #ff58cd); }
@media (max-width: 1200px) {
  .zk-grid { grid-template-columns: 1fr; }
  .zk-header { grid-template-columns: 70px 1fr; }
  .danger { grid-column: span 2; }
}
`;
