-- Messages.app : reçoit uniquement des arguments du programme (aucune interpolation).
-- Pas de shell, pas de sélection de contact par nom, pas de service de substitution.
on run argv
    if (count of argv) is not 3 then error "invalid_arguments"
    set requestedChannel to item 1 of argv
    set recipientPhone to item 2 of argv
    set messageText to item 3 of argv
    tell application "Messages"
        if requestedChannel is "imessage" then
            set targetService to first service whose service type is iMessage
        else if requestedChannel is "sms" then
            set targetService to first service whose service type is SMS
        else
            error "unsupported_channel"
        end if
        set targetBuddy to buddy recipientPhone of targetService
        send messageText to targetBuddy
    end tell
    return "accepted_by_messages"
end run
