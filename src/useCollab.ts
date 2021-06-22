import { ExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";
import {
  AppState,
  ExcalidrawAPIRefValue,
} from "@excalidraw/excalidraw/types/types";
import { nanoid } from "nanoid";
import { RefObject, useCallback, useMemo, useRef, useState } from "react";
import debounce from "lodash.debounce";

const API_BASE_URL = "http://localhost:8080";

type UpdateMessage =
  | {
      type: MessageType.UpdateScene;
      elements: readonly ExcalidrawElement[];
    }
  | {
      type: MessageType.Join;
    };

enum MessageType {
  UpdateScene = "UPDATE_SCENE",
  Join = "JOIN",
}

export const useCollab = (
  roomId: string,
  excalidrawRef: RefObject<ExcalidrawAPIRefValue>
) => {
  const [sessionId, setSessionId] = useState<string | undefined>();
  const elementsRef = useRef<Record<string, number>>({});

  const onPeerUpdate = useCallback(
    (data: string) => {
      const payload: UpdateMessage = JSON.parse(data);

      switch (payload.type) {
        case MessageType.UpdateScene: {
          const { elements } = payload;
          if (excalidrawRef.current?.ready) {
            const elementsVersionById = Object.fromEntries(
              elements.map(({ id, version }) => [id, version])
            );
            elementsRef.current = elementsVersionById;
            console.log({ elements, elementsVersionById });

            excalidrawRef.current?.updateScene({ elements });
          }
        }
      }
    },
    [excalidrawRef]
  );

  const startSession = useCallback(async () => {
    if (!excalidrawRef.current?.ready) {
      console.log(excalidrawRef.current);
      return;
    }

    const newSessionId = nanoid();

    const roomUrl = new URL(API_BASE_URL);
    roomUrl.pathname = `/rooms/${roomId}`;

    const response = await fetch(roomUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: newSessionId,
        payload: JSON.stringify({ type: MessageType.Join }),
      }),
    });
    if (!response.ok) {
      console.error("Session could not be created", { newSessionId, response });
      return;
    }

    const sessionUrl = new URL(API_BASE_URL);
    sessionUrl.pathname = `/rooms/${roomId}/${newSessionId}`;

    const stream = new EventSource(sessionUrl.toString());

    const ready = new Promise((resolve) => {
      stream.addEventListener("open", resolve, { once: true });
    });
    stream.addEventListener("client", (event: Event) => {
      onPeerUpdate((event as MessageEvent).data);
    });
    stream.addEventListener("error", console.error);
    await ready;
    setSessionId(newSessionId);
    console.info("Session created", { newSessionId });
  }, [roomId, excalidrawRef, onPeerUpdate]);

  // useMemo instead of useCallback to avoid warning
  // "React Hook useCallback received a function whose dependencies are unknown"
  const onChange = useMemo(
    () =>
      debounce(
        async (elements: readonly ExcalidrawElement[], _appState: AppState) => {
          if (!sessionId) {
            return;
          }
          const elementVersionsMatch = elements.every(
            (element) => elementsRef.current[element.id] === element.version
          );
          if (elementVersionsMatch) {
            return;
          }

          const roomUrl = new URL(API_BASE_URL);
          roomUrl.pathname = `/rooms/${roomId}`;

          const payload: UpdateMessage = {
            type: MessageType.UpdateScene,
            elements,
          };

          const response = await fetch(roomUrl.toString(), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: sessionId,
              payload: JSON.stringify(payload),
            }),
          });
          if (!response.ok) {
            console.error("Session could not be created", {
              response,
            });
            return;
          }
        },
        300
      ),
    [roomId, sessionId]
  );

  return { startSession, onChange };
};
