import streamDeck from "@elgato/streamdeck";
import { ChannelKeyAction } from "./actions/channel-key.js";

streamDeck.actions.registerAction(new ChannelKeyAction());

void streamDeck.connect();
