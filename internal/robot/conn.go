package robot

// MessageHandler is the message handling interface called by the Feishu/DingTalk long connections (implemented by handler.RobotHandler)
type MessageHandler interface {
	HandleMessage(platform, userID, text string) string
}
