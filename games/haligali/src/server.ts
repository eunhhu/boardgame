import { createBoardgameServer, portFromArgs } from "@bgame/server";
import { haligaliGame } from "./game";

const port = portFromArgs();
const { server } = await createBoardgameServer({
  game: haligaliGame,
  clientEntry: `${import.meta.dir}/main.tsx`,
  port,
});

console.log(`Halli Galli is running at ${server.url}`);
console.log("Open the URL in two browser windows to test multiplayer.");
