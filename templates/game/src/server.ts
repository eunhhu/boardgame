import { createBoardgameServer, portFromArgs } from "@bgame/server";
import { __GAME_IDENTIFIER__Game } from "./game";

const port = portFromArgs();
const { server } = await createBoardgameServer({
  game: __GAME_IDENTIFIER__Game,
  clientEntry: `${import.meta.dir}/main.tsx`,
  port,
});

console.log(`__GAME_TITLE__ is running at ${server.url}`);
