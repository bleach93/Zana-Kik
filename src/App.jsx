// Imports necesarios para que la aplicación funcione
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { doc, setDoc, updateDoc, onSnapshot, getDoc } from "firebase/firestore";
import { db } from "./firebase";
// Definición de los alimentos disponibles en el juego, sus efectos y sus íconos
const FOODS = [
  { id: "agua", name: "Agua", icon: "💧", effect: "No pasa nada" },
  { id: "helado", name: "Helado", icon: "🍦", effect: "Elige a quién kikear" },
  { id: "zanahoria", name: "Zanahoria", icon: "🥕", effect: "Pierdes / kik" },
  { id: "azar", name: "Azar", icon: "🎲", effect: "Bolas cazadoras, pierdes si te toca" },
];
// Definicion de los roles del juego y sus íconos correspondientes
const ROLES = ["Dueño", "Guía", "Jugador"];

const ROLE_ICONS = {
  Dueño: "👑",
  Guía: "🛡️",
  Jugador: "🎮",
};
// Nombres de bots para partidas de prueba
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
// Función auxiliar para seleccionar un elemento aleatorio de una lista
function random(list) {
  return list[Math.floor(Math.random() * list.length)];
}
// Función para generar un ID de usuario local y almacenarlo en el almacenamiento local del navegador
function makeLocalUserId() {
  const saved = localStorage.getItem("zk_user_id");
  if (saved) return saved;

  const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  localStorage.setItem("zk_user_id", id);
  return id;
}
// Función para generar un ID de sala aleatorio
function makeRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}
// Componente principal de la aplicación que contiene toda la lógica del juego y la interfaz de usuario
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
  
  const chatEndRef = useRef(null);
    useEffect(() => {
    chatEndRef.current?.scrollIntoView({
      behavior: "smooth"
    });
  }, [chat]);
  // Filtrar los jugadores activos para determinar quién tiene el turno actual, si el jugador actual es un bot, si es el turno del usuario local, y si se puede resolver la acción de sacar helado (es decir, si el objeto sacado es helado, es el turno del usuario local y el jugador actual no es un bot)
  const activePlayers = players.filter((p) => p.active);
  const currentPlayer = activePlayers[turn % Math.max(activePlayers.length, 1)];
  // Variables booleanas para determinar si el jugador actual es un bot, si es el turno del usuario local, y si se puede resolver la acción de sacar helado (es decir, si el objeto sacado es helado, es el turno del usuario local y el jugador actual no es un bot)
  const currentPlayerIsBot = currentPlayer?.isBot;
  const isMyTurn = currentPlayer?.id === localUserId.current;
  const canResolveHelado = item?.id === "helado" && isMyTurn && !currentPlayer?.isBot;
  // Cálculo de las posiciones de los jugadores alrededor de la nevera utilizando useMemo para optimizar el rendimiento
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
  // Función para actualizar el estado local y remoto de la sala con un parche de cambios
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
  // Función para agregar una entrada al registro de eventos del juego y actualizar la sala
  function addLog(text) {
    const nextLog = [text, ...log].slice(0, 8);
    setLog(nextLog);
    updateRoom({ log: nextLog }).catch(console.error);
  }
  // Función para avanzar el turno al siguiente jugador activo, reiniciar el temporizador y actualizar la sala
  function nextTurnFromPlayers(nextPlayers = players) {
    const alive = nextPlayers.filter((p) => p.active);
    if (alive.length <= 1) return turn;
    // Si el jugador actual es eliminado, avanzar el turno al siguiente jugador activo para evitar que quede bloqueado. De lo contrario, avanzar el turno normalmente al siguiente jugador activo.
    const nextTurn = (turn + 1) % alive.length;
    setSeconds(12);
    setTurn(nextTurn);
    updateRoom({ turn: nextTurn }).catch(console.error);
    // Reiniciar estados relacionados con la selección de víctima y el proceso de sacar un objeto, para evitar que queden bloqueados después de eliminar a un jugador o avanzar el turno
    return nextTurn;
  }
  // Función para eliminar a un jugador de la ronda (kikearlo), actualizar el registro de eventos, verificar si hay un ganador y actualizar la sala en consecuencia
  function kickPlayer(id, reason) {
    const victim = players.find((p) => p.id === id);
    if (!victim) return;

    const nextPlayers = players.map((p) =>
      p.id === id ? { ...p, active: false } : p
    );
    // Filtrar los jugadores activos después de eliminar al jugador para verificar si solo queda uno y declararlo ganador automáticamente, o avanzar al siguiente turno normalmente si quedan varios jugadores activos
    const alive = nextPlayers.filter((p) => p.active);
    const nextLog = [`${victim.name} fue kikeado: ${reason}.`, ...log].slice(0, 8);
    // Si el jugador eliminado es el que tiene el turno actual, avanzar el turno al siguiente jugador activo para evitar que quede bloqueado
    const patch = {
      players: nextPlayers,
      item: null,
      log: nextLog,
    };
    // Reiniciar estados relacionados con la selección de víctima y el proceso de sacar un objeto, para evitar que queden bloqueados después de eliminar a un jugador
    setWaitingKickSelection(false);
    setDrawing(false);
    // Si el jugador eliminado es el usuario local, mostrar la pantalla de derrota
    if (victim.id === localUserId.current) {
      setLoser(victim);
    }
    // Si solo queda un jugador activo, declararlo ganador y finalizar la ronda. De lo contrario, avanzar al siguiente turno normalmente.
    if (alive.length === 1) {
      patch.winner = alive[0];
      patch.message = `🏆 ${alive[0].name} gana la ronda.`;
      patch.turn = 0;
    } else {
      patch.turn = (turn + 1) % alive.length;
      patch.message = message;
    }
    // Actualizar el estado local y remoto con los cambios resultantes de eliminar al jugador
    setLocalAndRemote(patch);
  }
  // Función para manejar la acción de sacar un objeto de la nevera, determinar el resultado, actualizar el estado del juego y la sala en consecuencia
  function drawObject() {
    if (!currentPlayer || activePlayers.length <= 1 || drawing) return;
    if (!currentPlayer.isBot && !isMyTurn) return;
    // Iniciar el proceso de sacar un objeto, mostrar un mensaje de acción en curso, y simular una animación de sacar el objeto con un retraso antes de resolver el resultado para mejorar la experiencia de usuario y evitar que la interfaz quede bloqueada durante el proceso
    setDrawing(true);
    setItem(null);
    setMessage(`${currentPlayer.name} está abriendo la nevera...`);
    // Simular el proceso de sacar un objeto con una animación y retrasar la resolución del resultado para mejorar la experiencia de usuario, evitando que quede bloqueada la interfaz durante el proceso
    setTimeout(() => {
      const result = random(FOODS.filter((food) => food.id !== "azar"));
      const nextPlayers = players.map((p) =>
        p.id === currentPlayer.id ? { ...p, lastItem: result } : p
      );
      //  Actualizar el registro de eventos con el resultado de sacar el objeto, y preparar los cambios necesarios para actualizar la sala según el efecto del objeto sacado (avanzar turno, seleccionar víctima, eliminar jugador, etc.) dependiendo del tipo de objeto sacado y su efecto correspondiente
      let nextLog = [`${currentPlayer.name} sacó ${result.name}.`, ...log].slice(0, 8);
      let nextTurn = turn;
      let nextMessage = "";
      let nextItem = result;
      // Reiniciar estados relacionados con la selección de víctima y el proceso de sacar un objeto, para evitar que queden bloqueados después de resolver el resultado
      setDrawing(false);
      setPlayers(nextPlayers);
      setItem(result);
      // Determinar el efecto del objeto sacado y preparar los cambios necesarios para actualizar la sala en consecuencia, como avanzar el turno al siguiente jugador activo, mostrar un mensaje de acción, activar la selección de víctima, eliminar al jugador actual, etc., dependiendo del tipo de objeto sacado y su efecto correspondiente
      if (result.id === "agua") {
        nextMessage = "💧 Agua: no pasa nada. Pasa el siguiente jugador.";
        nextTurn = (turn + 1) % nextPlayers.filter((p) => p.active).length;
        setWaitingKickSelection(false);
      }
      // Si el objeto sacado es helado, activar la selección de víctima para que el jugador actual elija a quién kikear, y mostrar un mensaje de acción correspondiente. La resolución de la selección de víctima se manejará en otra función que se activará al seleccionar a un jugador como víctima.
      if (result.id === "helado") {
        nextMessage = "🍦 Helado: elige un jugador para kikear.";
        setWaitingKickSelection(true);
      }
      // Si el objeto sacado es zanahoria, eliminar al jugador actual de la ronda automáticamente, mostrar un mensaje de acción correspondiente, y avanzar al siguiente turno al siguiente jugador activo para evitar que quede bloqueado el turno después de eliminar al jugador actual. La resolución de la eliminación del jugador se manejará en otra función que se activará después de mostrar el mensaje de acción correspondiente.
      if (result.id === "zanahoria") {
        nextMessage = "🥕 Zanahoria: pierdes y sales de la ronda.";
        setWaitingKickSelection(false);
        // Actualizar el estado local y remoto con los cambios resultantes de eliminar al jugador actual, mostrar el mensaje de acción correspondiente, y avanzar al siguiente turno al siguiente jugador activo para evitar que quede bloqueado el turno después de eliminar al jugador actual. La resolución de la eliminación del jugador se manejará en otra función que se activará después de mostrar el mensaje de acción correspondiente.
        setLocalAndRemote({
          players: nextPlayers,
          item: result,
          log: nextLog,
          message: nextMessage,
        });
        // Agregar un retraso antes de eliminar al jugador actual para permitir que el mensaje de acción se muestre y mejore la experiencia de usuario, evitando que quede bloqueada la interfaz durante el proceso
        setTimeout(() => kickPlayer(currentPlayer.id, "sacó zanahoria"), 500);
        return;
      }
      // Actualizar el estado local y remoto con los cambios resultantes de sacar el objeto, mostrar el mensaje de acción correspondiente, y actualizar el turno si es necesario según el efecto del objeto sacado. La resolución de efectos adicionales como la selección de víctima para el helado o las bolas cazadoras para el azar se manejará en otras funciones que se activarán después de mostrar el mensaje de acción correspondiente.
      setLocalAndRemote({
        players: nextPlayers,
        item: nextItem,
        log: nextLog,
        message: nextMessage,
        turn: nextTurn,
      });
    }, 900);
  }
  // Función para manejar la acción de activar el efecto de azar, que consiste en seleccionar aleatoriamente a un jugador como víctima de las bolas cazadoras, eliminarlo de la ronda, mostrar un mensaje de acción correspondiente, y actualizar el registro de eventos y la sala en consecuencia. La función verifica las condiciones necesarias para activar el efecto de azar (que haya un jugador actual, que haya más de un jugador activo, que se pueda resolver el efecto de helado, etc.) antes de proceder con la acción.
  function azar() {
    if (!currentPlayer || activePlayers.length <= 1) return;
    if (!canResolveHelado) return;
    // Iniciar el proceso de activar el efecto de azar, mostrar un mensaje de acción en curso, y simular una animación de activación con un retraso antes de resolver el resultado para mejorar la experiencia de usuario y evitar que la interfaz quede bloqueada durante el proceso
    setWaitingKickSelection(false);
    setDrawing(false);
    setItem(null);
    // Actualizar el registro de eventos con la activación del efecto de azar, y preparar los cambios necesarios para actualizar la sala según el resultado de seleccionar aleatoriamente a un jugador como víctima de las bolas cazadoras, eliminarlo de la ronda, mostrar un mensaje de acción correspondiente, y actualizar el registro de eventos y la sala en consecuencia. La resolución de la selección de víctima y la eliminación del jugador se manejará en otra función que se activará después de mostrar el mensaje de acción correspondiente.
    const nextLog = [`${currentPlayer.name} activó AZAR.`, ...log].slice(0, 8);
    setLog(nextLog);
    setMessage("🎲 AZAR: bolas cazadoras activadas...");
    //  Agregar un retraso antes de resolver el resultado de azar para permitir que el mensaje de acción se muestre y mejore la experiencia de usuario, evitando que quede bloqueada la interfaz durante el proceso
    setTimeout(() => {
      const possibleVictims = activePlayers.filter((p) => p.id !== currentPlayer.id);
      const victim = random(possibleVictims);
      // Si no hay víctimas posibles (lo cual es improbable pero se verifica por seguridad), simplemente actualizar el mensaje de acción y el registro de eventos sin eliminar a ningún jugador
      if (!victim) return;
      // Actualizar el registro de eventos con el resultado de seleccionar aleatoriamente a un jugador como víctima de las bolas cazadoras, eliminarlo de la ronda, mostrar un mensaje de acción correspondiente, y actualizar la sala en consecuencia. La resolución de la eliminación del jugador se manejará en otra función que se activará después de mostrar el mensaje de acción correspondiente.
      const finalLog = [
        `${victim.name} fue alcanzado por las bolas cazadoras.`,
        ...nextLog,
      ].slice(0, 8);
      // Agregar un retraso antes de eliminar al jugador víctima para permitir que el mensaje de acción se muestre y mejore la experiencia de usuario, evitando que quede bloqueada la interfaz durante el proceso
      setLog(finalLog);
      updateRoom({ log: finalLog }).catch(console.error);
      kickPlayer(victim.id, "azar");
    }, 850);
  }
  // Funciones para crear una sala en línea y unirse a una sala existente, que manejan la interacción con la base de datos de Firebase para almacenar y actualizar el estado de la sala, los jugadores, el turno, el registro de eventos, el chat, etc., y actualizan el estado local de la aplicación en consecuencia. Estas funciones también manejan la lógica de verificación de condiciones para unirse a una sala (como verificar si la sala existe, si el jugador ya está dentro, etc.) y para crear una sala (como generar un ID de sala único, establecer el jugador como dueño, etc.), así como la navegación a la URL de la sala correspondiente después de unirse o crear una sala.
  async function createOnlineRoom(roomPlayers) {
    const newRoomId = makeRoomId();
    const url = `${window.location.origin}/room/${newRoomId}`;
    // Crear un nuevo documento en la colección "rooms" de Firebase con el ID de sala generado, y establecer los datos iniciales de la sala como el ID de sala, el ID del dueño, la lista de jugadores, el turno inicial, el objeto sacado inicial, el registro de eventos inicial, el chat inicial, el mensaje inicial, el ganador inicial (null), y la fecha de creación. Luego actualizar el estado local con el ID de sala y la URL para compartir, y navegar a la URL de la sala correspondiente.
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
    // Actualizar el estado local con el ID de sala y la URL para compartir, y navegar a la URL de la sala correspondiente
    setRoomId(newRoomId);
    setShareUrl(url);
    window.history.pushState(null, "", `/room/${newRoomId}`);
  }
  // Función para unirse a una sala en línea existente, que verifica si la sala existe, si el jugador ya está dentro de la sala, y si no, agrega al jugador a la lista de jugadores de la sala en Firebase, actualiza el registro de eventos de la sala con la entrada del nuevo jugador, y actualiza el estado local con el ID de sala, la URL para compartir, y el rol de jugador. Si la sala no existe, muestra una alerta al usuario.
   async function joinOnlineRoom(joinRoomId, player) {
    const roomRef = doc(db, "rooms", joinRoomId);
    const snap = await getDoc(roomRef);
    // Verificar si la sala existe en Firebase antes de intentar unirse, para evitar errores y mostrar una alerta al usuario si la sala no existe. Si la sala existe, verificar si el jugador ya está dentro de la sala para evitar agregarlo nuevamente, y si no está dentro, agregarlo a la lista de jugadores de la sala en Firebase, actualizar el registro de eventos de la sala con la entrada del nuevo jugador, y actualizar el estado local con el ID de sala, la URL para compartir, y el rol de jugador. Si la sala no existe, mostrar una alerta al usuario indicando que la sala no existe.
    if (!snap.exists()) {
      alert("La sala no existe.");
      return;
    }
    // Verificar si el jugador ya está dentro de la sala para evitar agregarlo nuevamente, y si no está dentro, agregarlo a la lista de jugadores de la sala en Firebase, actualizar el registro de eventos de la sala con la entrada del nuevo jugador, y actualizar el estado local con el ID de sala, la URL para compartir, y el rol de jugador. Si el jugador ya está dentro de la sala, simplemente actualizar el estado local con el ID de sala, la URL para compartir, y el rol de jugador sin modificar la lista de jugadores en Firebase ni el registro de eventos.
    const data = snap.data();
    const currentPlayers = data.players || [];
    // Verificar si el jugador ya está dentro de la sala para evitar agregarlo nuevamente, y si no está dentro, agregarlo a la lista de jugadores de la sala en Firebase, actualizar el registro de eventos de la sala con la entrada del nuevo jugador, y actualizar el estado local con el ID de sala, la URL para compartir, y el rol de jugador. Si el jugador ya está dentro de la sala, simplemente actualizar el estado local con el ID de sala, la URL para compartir, y el rol de jugador sin modificar la lista de jugadores en Firebase ni el registro de eventos.
    const alreadyInside = currentPlayers.some(
      (p) =>
        p.id === player.id ||
        p.habboName?.toLowerCase() ===
          player.habboName?.toLowerCase()
    );
    // Si el jugador ya está dentro de la sala, simplemente actualizar el estado local con el ID de sala, la URL para compartir, y el rol de jugador sin modificar la lista de jugadores en Firebase ni el registro de eventos. Si el jugador no está dentro de la sala, agregarlo a la lista de jugadores de la sala en Firebase, actualizar el registro de eventos de la sala con la entrada del nuevo jugador, y actualizar el estado local con el ID de sala, la URL para compartir, y el rol de jugador.
    if (alreadyInside) {
      setRoomId(joinRoomId);
      setShareUrl(
        `${window.location.origin}/room/${joinRoomId}`
      );
      setShowRoomModal(false);
      setRole("Jugador");
      return;
    }
    // Agregar al jugador a la lista de jugadores de la sala en Firebase, actualizar el registro de eventos de la sala con la entrada del nuevo jugador, y actualizar el estado local con el ID de sala, la URL para compartir, y el rol de jugador. Luego, navegar a la URL de la sala correspondiente.
    const nextPlayers = [...currentPlayers, player];
    // Actualizar el registro de eventos de la sala con la entrada del nuevo jugador, y actualizar la sala en Firebase con la nueva lista de jugadores y el nuevo registro de eventos. Luego, actualizar el estado local con el ID de sala, la URL para compartir, y el rol de jugador, y navegar a la URL de la sala correspondiente.
    await updateDoc(roomRef, {
      players: nextPlayers,
      log: [
        `${player.name} entró a la sala.`,
        ...(data.log || []),
      ].slice(0, 8),
    });
}
  // Efectos para manejar la sincronización del estado de la sala con Firebase, la lógica de temporizador para avanzar el turno automáticamente, y la lógica de comportamiento de los bots en partidas de prueba, entre otros aspectos relacionados con la dinámica del juego y la interacción con la base de datos en tiempo real. Estos efectos se activan en función de cambios en el estado relevante (como el ID de sala, el jugador actual, el objeto sacado, etc.) y manejan la lógica correspondiente para mantener la experiencia de juego fluida y sincronizada entre los jugadores.
  useEffect(() => {
    const pathRoomId = window.location.pathname.split("/room/")[1];
    if (!pathRoomId) return;
    // Si hay un ID de sala en la URL, configurar el estado local con el ID de sala, la URL para compartir, y mostrar el modal de unión a sala. Luego, establecer un listener en Firebase para sincronizar el estado de la sala en tiempo real con los cambios en la base de datos, actualizando el estado local con los datos de la sala (jugadores, turno, objeto sacado, registro de eventos, chat, mensaje, ganador, etc.) cada vez que haya un cambio en la sala. El efecto también maneja la limpieza del listener al desmontar el componente para evitar fugas de memoria.
    setRoomId(pathRoomId);
    setShareUrl(`${window.location.origin}/room/${pathRoomId}`);
    setShowRoomModal(true);
    // Establecer un listener en Firebase para sincronizar el estado de la sala en tiempo real con los cambios en la base de datos, actualizando el estado local con los datos de la sala (jugadores, turno, objeto sacado, registro de eventos, chat, mensaje, ganador, etc.) cada vez que haya un cambio en la sala. El efecto también maneja la limpieza del listener al desmontar el componente para evitar fugas de memoria.
    const unsub = onSnapshot(doc(db, "rooms", pathRoomId), (snap) => {
      if (!snap.exists()) return;
      // Actualizar el estado local con los datos de la sala cada vez que haya un cambio en la sala, para mantener la experiencia de juego sincronizada entre los jugadores. Esto incluye actualizar la lista de jugadores, el turno actual, el objeto sacado, el registro de eventos, el chat, el mensaje, el ganador, etc., según los datos almacenados en Firebase.
      const room = snap.data();
      // Actualizar el estado local con los datos de la sala cada vez que haya un cambio en la sala, para mantener la experiencia de juego sincronizada entre los jugadores. Esto incluye actualizar la lista de jugadores, el turno actual, el objeto sacado, el registro de eventos, el chat, el mensaje, el ganador, etc., según los datos almacenados en Firebase.
      setPlayers(room.players || []);
      setTurn(room.turn || 0);
      setItem(room.item || null);
      setLog(room.log || []);
      setChat(room.chat || []);
      setMessage(room.message || "¡Saca un objeto de la nevera!");
      setWinner(room.winner || null);
      // Verificar si el jugador local está dentro de la sala cada vez que haya un cambio en la sala, para determinar si se debe mostrar el modal de unión a sala o no, y para actualizar el rol del jugador local según su estado en la sala (dueño, guía, jugador, etc.). Si el jugador local no está dentro de la sala, mostrar el modal de unión a sala para permitir que se una. Si el jugador local está dentro de la sala, ocultar el modal de unión a sala y actualizar el rol del jugador local según su estado en la sala.
      const me = (room.players || []).find(
        (p) => p.id === localUserId.current
      );
      // Si el jugador local está dentro de la sala, ocultar el modal de unión a sala y actualizar el rol del jugador local según su estado en la sala. Si el jugador local no está dentro de la sala, mostrar el modal de unión a sala para permitir que se una.
      if (me) {
        setShowRoomModal(false);
        setHabboName(me.habboName || me.name || "");
        // Actualizar el rol del jugador local según su estado en la sala (dueño, guía, jugador, etc.) cada vez que haya un cambio en la sala, para reflejar correctamente su rol en la experiencia de juego. Esto se determina principalmente por la propiedad "isOwner" del jugador local, pero también se puede extender para incluir otras condiciones o roles adicionales si se desea.
        if (me.isOwner) {
          setRole("Dueño");
        } else {
          setRole("Jugador");
        }
      } else {
        setShowRoomModal(false);
      }
    });
    // Limpiar el listener de Firebase al desmontar el componente para evitar fugas de memoria y asegurar que no haya listeners activos innecesarios cuando el componente ya no está en uso.
    return () => unsub();
  }, []);
  // Efecto para sincronizar el estado de la sala con Firebase en tiempo real, actualizando el estado local cada vez que haya un cambio en la sala (jugadores, turno, objeto sacado, registro de eventos, chat, mensaje, ganador, etc.) para mantener la experiencia de juego sincronizada entre los jugadores. El efecto se activa cada vez que cambia el ID de sala (roomId) y establece un listener en Firebase para escuchar los cambios en la sala correspondiente, actualizando el estado local con los datos de la sala cada vez que haya un cambio. El efecto también maneja la limpieza del listener al desmontar el componente para evitar fugas de memoria.
  useEffect(() => {
    if (!roomId) return;
    // Establecer un listener en Firebase para sincronizar el estado de la sala en tiempo real con los cambios en la base de datos, actualizando el estado local con los datos de la sala (jugadores, turno, objeto sacado, registro de eventos, chat, mensaje, ganador, etc.) cada vez que haya un cambio en la sala. El efecto también maneja la limpieza del listener al desmontar el componente para evitar fugas de memoria.
    const unsub = onSnapshot(doc(db, "rooms", roomId), (snap) => {
      if (!snap.exists()) return;
      // Actualizar el estado local con los datos de la sala cada vez que haya un cambio en la sala, para mantener la experiencia de juego sincronizada entre los jugadores. Esto incluye actualizar la lista de jugadores, el turno actual, el objeto sacado, el registro de eventos, el chat, el mensaje, el ganador, etc., según los datos almacenados en Firebase.
      const room = snap.data();
      //  Actualizar el estado local con los datos de la sala cada vez que haya un cambio en la sala, para mantener la experiencia de juego sincronizada entre los jugadores. Esto incluye actualizar la lista de jugadores, el turno actual, el objeto sacado, el registro de eventos, el chat, el mensaje, el ganador, etc., según los datos almacenados en Firebase.
      setPlayers(room.players || []);
      setTurn(room.turn || 0);
      setItem(room.item || null);
      setLog(room.log || []);
      setChat(room.chat || []);
      setMessage(room.message || "¡Saca un objeto de la nevera!");
      setWinner(room.winner || null);
    });
    // Limpiar el listener de Firebase al desmontar el componente para evitar fugas de memoria y asegurar que no haya listeners activos innecesarios cuando el componente ya no está en uso.
    return () => unsub();
  }, [roomId]);
  // Efecto para manejar la lógica del temporizador que avanza el turno automáticamente después de un tiempo determinado (12 segundos) si el jugador actual no realiza una acción (sacar un objeto, seleccionar víctima, etc.) dentro de ese tiempo. El efecto se activa cada vez que cambian el jugador actual, el objeto sacado, la cantidad de jugadores activos, o si hay un ganador, y maneja la lógica para avanzar el turno al siguiente jugador activo automáticamente cuando se agota el tiempo, evitando que quede bloqueado el turno si un jugador no realiza una acción a tiempo. El efecto también maneja la limpieza del temporizador al desmontar el componente o al cambiar las dependencias relevantes para evitar que queden temporizadores activos innecesarios.
  useEffect(() => {
    if (!currentPlayer || activePlayers.length <= 1 || item?.id === "helado" || winner) return;
    // Reiniciar el temporizador a 12 segundos cada vez que cambian el jugador actual, el objeto sacado, la cantidad de jugadores activos, o si hay un ganador, para dar a cada jugador un tiempo limitado para realizar su acción antes de que el turno avance automáticamente al siguiente jugador activo. El efecto también maneja la lógica para avanzar el turno al siguiente jugador activo automáticamente cuando se agota el tiempo, evitando que quede bloqueado el turno si un jugador no realiza una acción a tiempo.
    setSeconds(12);
    // Iniciar un temporizador que se ejecuta cada segundo para decrementar el contador de segundos, y cuando el contador llega a 0, avanzar el turno al siguiente jugador activo automáticamente si el jugador actual no realizó una acción a tiempo. El efecto también maneja la lógica para evitar que el turno avance automáticamente si ya hay un ganador o si el objeto sacado es helado (lo cual requiere una acción específica del jugador), y para evitar que el turno avance automáticamente si ya se está en proceso de selección de víctima o de sacar un objeto para evitar que quede bloqueada la interfaz durante esos procesos.
    const timer = setInterval(() => {
      setSeconds((prev) => {
        if (prev <= 1) {
          if (!timerLock.current) {
            timerLock.current = true;
            // Avanzar el turno al siguiente jugador activo automáticamente cuando se agota el tiempo, evitando que quede bloqueado el turno si un jugador no realiza una acción a tiempo. El efecto también maneja la lógica para evitar que el turno avance automáticamente si ya hay un ganador o si el objeto sacado es helado (lo cual requiere una acción específica del jugador), y para evitar que el turno avance automáticamente si ya se está en proceso de selección de víctima o de sacar un objeto para evitar que quede bloqueada la interfaz durante esos procesos.
            const nextTurn = (turn + 1) % activePlayers.length;
            setTurn(nextTurn);
            updateRoom({ turn: nextTurn }).catch(console.error);
            // Reiniciar el temporizador a 12 segundos para el siguiente jugador activo, y evitar que quede bloqueada la interfaz durante el proceso de avance de turno automático.
            setTimeout(() => {
              timerLock.current = false;
            }, 200);
          }
          // Devolver 12 para reiniciar el contador de segundos para el siguiente jugador activo después de avanzar el turno automáticamente, y evitar que quede bloqueada la interfaz durante el proceso de avance de turno automático.
          return 12;
        }
        // Decrementar el contador de segundos cada segundo para dar a cada jugador un tiempo limitado para realizar su acción antes de que el turno avance automáticamente al siguiente jugador activo, y evitar que quede bloqueada la interfaz durante el proceso de espera.
        return prev - 1;
      });
    }, 1000);
    // Limpiar el temporizador al desmontar el componente o al cambiar las dependencias relevantes para evitar que queden temporizadores activos innecesarios, y asegurar que no haya temporizadores corriendo en segundo plano cuando el componente ya no está en uso o cuando cambian las condiciones del juego.
    return () => clearInterval(timer);
  }, [currentPlayer?.id, item?.id, activePlayers.length, winner, turn]);
  // Efecto para manejar la lógica de comportamiento de los bots en partidas de prueba, que consiste en que los bots saquen un objeto automáticamente después de un tiempo determinado (1.2 segundos) si es su turno y no están en proceso de sacar un objeto o seleccionar víctima, y si el objeto sacado no es helado (lo cual requiere una acción específica del jugador). El efecto se activa cada vez que cambian el jugador actual, el objeto sacado, la cantidad de jugadores activos, o si hay un ganador, y maneja la lógica para que los bots realicen su acción automáticamente cuando es su turno, evitando que quede bloqueada la interfaz durante el proceso.
  useEffect(() => {
    if (!currentPlayer?.isBot) return;
    if (drawing) return;
    if (item?.id === "helado") return;
    if (activePlayers.length <= 1) return;
    if (winner) return;
    // Iniciar un temporizador que se ejecuta después de 1.2 segundos para que el bot saque un objeto automáticamente si es su turno y no está en proceso de sacar un objeto o seleccionar víctima, y si el objeto sacado no es helado (lo cual requiere una acción específica del jugador). El efecto también maneja la lógica para evitar que el bot saque un objeto automáticamente si ya hay un ganador o si el objeto sacado es helado, y para evitar que el bot saque un objeto automáticamente si ya se está en proceso de selección de víctima o de sacar un objeto para evitar que quede bloqueada la interfaz durante esos procesos.
    const botTimer = setTimeout(() => {
      drawObject();
    }, 1200);
    // Limpiar el temporizador al desmontar el componente o al cambiar las dependencias relevantes para evitar que queden temporizadores activos innecesarios, y asegurar que no haya temporizadores corriendo en segundo plano cuando el componente ya no está en uso o cuando cambian las condiciones del juego.
    return () => clearTimeout(botTimer);
  }, [currentPlayer?.id, drawing, item?.id, activePlayers.length, winner]);
  // Efecto para manejar la lógica de comportamiento de los bots en partidas de prueba específicamente para el caso de sacar helado, que consiste en que los bots seleccionen automáticamente a una víctima para kikear después de sacar helado, si es su turno, si el objeto sacado es helado, y si no hay un ganador. El efecto se activa cada vez que cambian el jugador actual, el objeto sacado, la cantidad de jugadores activos, o si hay un ganador, y maneja la lógica para que los bots realicen su acción automáticamente cuando sacan helado, evitando que quede bloqueada la interfaz durante el proceso.
  useEffect(() => {
    if (!currentPlayer?.isBot) return;
    if (item?.id !== "helado") return;
    if (winner) return;
    // Iniciar un temporizador que se ejecuta después de 1.4 segundos para que el bot seleccione automáticamente a una víctima para kikear después de sacar helado, si es su turno, si el objeto sacado es helado, y si no hay un ganador. El efecto también maneja la lógica para evitar que el bot seleccione una víctima automáticamente si ya hay un ganador o si el objeto sacado no es helado, y para evitar que el bot seleccione una víctima automáticamente si ya se está en proceso de selección de víctima o de sacar un objeto para evitar que quede bloqueada la interfaz durante esos procesos.
    const botKickTimer = setTimeout(() => {
      const victims = activePlayers.filter((p) => p.id !== currentPlayer.id);
      const victim = random(victims);
      // Si no hay víctimas posibles (lo cual es improbable pero se verifica por seguridad), simplemente salir de la función sin seleccionar a ningún jugador ni realizar ninguna acción, para evitar que quede bloqueada la interfaz durante el proceso de selección de víctima automática.
      if (!victim) return;
      // Actualizar el registro de eventos con la selección automática de víctima por parte del bot después de sacar helado, mostrar un mensaje de acción correspondiente, y eliminar al jugador seleccionado como víctima de la ronda. La resolución de la eliminación del jugador se manejará en otra función que se activará después de mostrar el mensaje de acción correspondiente.
      addLog(`${currentPlayer.name} eligió al azar a ${victim.name} con helado.`);
      kickPlayer(victim.id, "elegido por bot con helado");
    }, 1400);
    // Limpiar el temporizador al desmontar el componente o al cambiar las dependencias relevantes para evitar que queden temporizadores activos innecesarios, y asegurar que no haya temporizadores corriendo en segundo plano cuando el componente ya no está en uso o cuando cambian las condiciones del juego.
    return () => clearTimeout(botKickTimer);
  }, [currentPlayer?.id, item?.id, activePlayers.length, winner]);
  // Funciones para crear una sala, unirse a una sala, salir de una sala, reiniciar el juego, y enviar mensajes de chat, que manejan la lógica correspondiente para cada acción, incluyendo la interacción con Firebase para actualizar el estado de la sala en línea, la actualización del estado local de la aplicación, y la navegación a las URLs correspondientes. Estas funciones también manejan la lógica de verificación de condiciones para cada acción (como verificar si la sala existe, si el jugador ya está dentro, si es el dueño de la sala, etc.) y actualizan el registro de eventos y los mensajes de acción en consecuencia para mantener la experiencia de juego fluida y coherente.
  async function createRoom(e) {
    e.preventDefault();
    // Verificar si hay un ID de sala en la URL para determinar si se va a crear una sala nueva o unirse a una sala existente, y preparar los datos del jugador local (ID, nombre, rol, etc.) para crear o unirse a la sala en consecuencia. Si hay un ID de sala en la URL, intentar unirse a esa sala con los datos del jugador local. Si no hay un ID de sala en la URL, crear una nueva sala con los datos del jugador local como dueño, y agregar bots si es una partida de prueba.
    const pathRoomId = window.location.pathname.split("/room/")[1];
    // Preparar los datos del jugador local (ID, nombre, rol, etc.) para crear o unirse a la sala en consecuencia. El jugador local se identifica principalmente por su ID único generado al cargar la aplicación, y puede proporcionar un nombre de Habbo opcional para personalizar su experiencia. El rol del jugador local se determina principalmente por si es el dueño de la sala o no, pero también se puede extender para incluir otras condiciones o roles adicionales si se desea.
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
    // Si hay un ID de sala en la URL, intentar unirse a esa sala con los datos del jugador local. Si no hay un ID de sala en la URL, crear una nueva sala con los datos del jugador local como dueño, y agregar bots si es una partida de prueba. La función también maneja la navegación a la URL de la sala correspondiente después de unirse o crear una sala.
    if (pathRoomId) {
      await joinOnlineRoom(pathRoomId, {
        ...ownerPlayer,
        isOwner: false,
      });
      return;
    }
    // Si es una partida de prueba, crear una nueva sala con los datos del jugador local como dueño, y agregar bots a la sala para simular una experiencia de juego completa. La función también maneja la navegación a la URL de la sala correspondiente después de crear la sala.
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
      // Crear una nueva sala con los datos del jugador local como dueño, y agregar bots a la sala para simular una experiencia de juego completa. La función también maneja la navegación a la URL de la sala correspondiente después de crear la sala.
      const roomPlayers = [ownerPlayer, ...bots];
      // Actualizar el estado local con la lista de jugadores de la sala (jugador local como dueño y bots), el rol del jugador local como dueño, habilitar la opción de jugar contra bots, y cerrar el modal de creación de sala. Luego, crear la sala en Firebase con la lista de jugadores preparada, y navegar a la URL de la sala correspondiente.
      setPlayers(roomPlayers);
      setRole("Dueño");
      setAiEnabled(true);
      setShowRoomModal(false);
      await createOnlineRoom(roomPlayers);
      return;
    }
    // Crear una nueva sala con los datos del jugador local como dueño, y sin bots, para una experiencia de juego tradicional. La función también maneja la navegación a la URL de la sala correspondiente después de crear la sala.
    setPlayers([ownerPlayer]);
    setRole("Dueño");
    setAiEnabled(false);
    setShowRoomModal(false);
    await createOnlineRoom([ownerPlayer]);
  }
  // Función para salir de una sala, que maneja la lógica para eliminar al jugador de la lista de jugadores de la sala en Firebase, actualizar el registro de eventos de la sala con la salida del jugador, y actualizar el estado local para reflejar que el jugador ha salido de la sala. Si el jugador que sale es el jugador local, también muestra el modal de unión a sala para permitir que se una a otra sala o cree una nueva, y restablece su rol a "Jugador".
  async function leaveRoom(playerId) {
    const nextPlayers = players.filter((p) => p.id !== playerId);
     // Actualizar el estado local para reflejar que el jugador ha salido de la sala, y si el jugador que sale es el jugador local, también mostrar el modal de unión a sala para permitir que se una a otra sala o cree una nueva, y restablecer su rol a "Jugador". Luego, si hay un ID de sala válido, actualizar la sala en Firebase para eliminar al jugador de la lista de jugadores de la sala, actualizar el registro de eventos de la sala con la salida del jugador, y mantener la experiencia de juego fluida y coherente para los jugadores restantes.
    setPlayers(nextPlayers);
    //  Actualizar la sala en Firebase para eliminar al jugador de la lista de jugadores de la sala, actualizar el registro de eventos de la sala con la salida del jugador, y mantener la experiencia de juego fluida y coherente para los jugadores restantes. Esto se hace principalmente para asegurar que el estado de la sala en línea refleje correctamente la salida del jugador, y para informar a los jugadores restantes sobre la salida a través del registro de eventos.
    if (roomId) {
      await updateRoom({
        players: nextPlayers,
        log: [`${players.find((p) => p.id === playerId)?.name || "Un jugador"} salió de la sala.`, ...log].slice(0, 8),
      });
    }
    // Si el jugador que sale es el jugador local, también mostrar el modal de unión a sala para permitir que se una a otra sala o cree una nueva, y restablecer su rol a "Jugador". Esto se hace principalmente para asegurar que el jugador local tenga la oportunidad de seguir participando en el juego, ya sea uniéndose a otra sala existente o creando una nueva sala, después de salir de la sala actual.
    if (playerId === localUserId.current) {
      setShowRoomModal(true);
      setRole("Jugador");
    }
  }
  // Función para reiniciar el juego, que maneja la lógica para restablecer el estado de la sala a su estado inicial para comenzar una nueva partida, manteniendo a los jugadores en la sala pero restableciendo sus estados individuales (activo, último objeto sacado, etc.) y el estado general del juego (turno, objeto sacado, ganador, mensaje, registro de eventos, etc.) para reflejar el inicio de una nueva partida. La función también actualiza el estado local y la sala en Firebase con los datos restablecidos para mantener la experiencia de juego fluida y coherente.
  function reset() {
    const nextPlayers = players.map((p) => ({
      ...p,
      active: true,
      lastItem: null,
    }));
    // Restablecer el estado de la sala a su estado inicial para comenzar una nueva partida, manteniendo a los jugadores en la sala pero restableciendo sus estados individuales (activo, último objeto sacado, etc.) y el estado general del juego (turno, objeto sacado, ganador, mensaje, registro de eventos, etc.) para reflejar el inicio de una nueva partida. La función también actualiza el estado local y la sala en Firebase con los datos restablecidos para mantener la experiencia de juego fluida y coherente.
    const patch = {
      players: nextPlayers,
      turn: 0,
      item: null,
      winner: null,
      message: "¡Saca un objeto de la nevera!",
      log: ["Juego reiniciado. Los jugadores siguen en la sala."],
    };
    // Restablecer el estado de la sala a su estado inicial para comenzar una nueva partida, manteniendo a los jugadores en la sala pero restableciendo sus estados individuales (activo, último objeto sacado, etc.) y el estado general del juego (turno, objeto sacado, ganador, mensaje, registro de eventos, etc.) para reflejar el inicio de una nueva partida. La función también actualiza el estado local y la sala en Firebase con los datos restablecidos para mantener la experiencia de juego fluida y coherente.
    setSeconds(12);
    setDrawing(false);
    setWinner(null);
    setLoser(null);
    setWaitingKickSelection(false);
    setLocalAndRemote(patch);
  }
  // Función para enviar mensajes de chat, que maneja la lógica para agregar el mensaje del jugador al chat de la sala, actualizar el estado local del chat, y actualizar la sala en Firebase con el nuevo mensaje de chat para mantener la experiencia de juego fluida y coherente. La función también verifica si el mensaje enviado es un comando especial (como "azar" para seleccionar una víctima al azar) y ejecuta la acción correspondiente si el jugador tiene los permisos necesarios (como ser administrador).
  async function sendChat(e) {
    e.preventDefault();
    // Verificar si el mensaje de chat ingresado no está vacío después de eliminar los espacios en blanco, para evitar enviar mensajes vacíos al chat de la sala. Si el mensaje está vacío, simplemente salir de la función sin realizar ninguna acción, para mantener la experiencia de juego fluida y coherente.
    const text = chatInput.trim();
    if (!text) return;
    // Agregar el mensaje del jugador al chat de la sala, actualizar el estado local del chat, y actualizar la sala en Firebase con el nuevo mensaje de chat para mantener la experiencia de juego fluida y coherente. El mensaje se formatea para incluir el ícono del rol del jugador, su nombre de Habbo (o su rol si no tiene un nombre de Habbo), y el texto del mensaje. Luego, se actualiza el estado local del chat con el nuevo mensaje agregado, y se actualiza la sala en Firebase para reflejar el nuevo estado del chat.
    const nextChat = [...chat,`${ROLE_ICONS[role]} ${habboName || role}: ${text}`].slice(-20);
    setChatInput("");
    setChat(nextChat);
    updateRoom({ chat: nextChat }).catch(console.error);
    // Verificar si el mensaje enviado es un comando especial (como "azar" para seleccionar una víctima al azar) y ejecutar la acción correspondiente si el jugador tiene los permisos necesarios (como ser administrador). Esto se hace principalmente para permitir que los jugadores con roles especiales (dueño, guía, etc.) puedan ejecutar comandos específicos a través del chat para interactuar con la dinámica del juego de manera más fluida y sin necesidad de interfaces adicionales.
    if (text.toLowerCase() === "azar" && isAdmin) {
      azar();
    }
  }
  // Renderizar la interfaz de usuario de la aplicación, que incluye el encabezado con el título y el botón para abandonar la sala, el panel lateral con la información del rol del jugador y la lista de jugadores, el área principal con el mensaje de acción, el objeto sacado, el registro de eventos, el chat, y los modales para crear/unirse a una sala, mostrar al ganador, y mostrar al perdedor. La interfaz también incluye estilos para mejorar la apariencia visual y la experiencia de usuario.
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

            <div ref={chatEndRef} />

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
