import { useEffect, useState } from "react";
import type { EnrichedInboxDb } from "@coral-xyz/common";
import { BACKEND_API_URL } from "@coral-xyz/common";

import { MessageList } from "./MessageList";
import { MessagesSkeleton } from "./MessagesSkeleton";
import { useStyles } from "./styles";

export const RequestsScreen = () => {
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [activeChats, setActiveChats] = useState<EnrichedInboxDb[]>([]);
  const classes = useStyles();

  const init = async () => {
    const res = await fetch(`${BACKEND_API_URL}/inbox?areConnected=false`);
    const json = await res.json();
    setMessagesLoading(false);
    setActiveChats(json.chats || []);
  };

  useEffect(() => {
    init();
  }, []);

  return (
    <div className={classes.container}>
      <br />
      <div
        className={classes.smallTitle}
        style={{
          display: "flex",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        These are not from your contacts. Click into a message to reply or view
        their profile.
      </div>
      <br />
      {messagesLoading && <MessagesSkeleton />}
      {!messagesLoading && activeChats.length !== 0 && (
        <MessageList activeChats={activeChats} />
      )}
    </div>
  );
};
