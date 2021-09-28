/*
Copyright 2021 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import React from "react";
import { IJoinRuleEventContent, JoinRule, RestrictedAllowType } from "matrix-js-sdk/src/@types/partials";
import { Room } from "matrix-js-sdk/src/models/room";
import { EventType } from "matrix-js-sdk/src/@types/event";

import StyledRadioGroup, { IDefinition } from "../elements/StyledRadioGroup";
import { _t } from "../../../languageHandler";
import AccessibleButton from "../elements/AccessibleButton";
import RoomAvatar from "../avatars/RoomAvatar";
import SpaceStore from "../../../stores/SpaceStore";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import Modal from "../../../Modal";
import ManageRestrictedJoinRuleDialog from "../dialogs/ManageRestrictedJoinRuleDialog";
import RoomUpgradeWarningDialog from "../dialogs/RoomUpgradeWarningDialog";
import QuestionDialog from "../dialogs/QuestionDialog";
import { upgradeRoom } from "../../../utils/RoomUpgrade";
import { arrayHasDiff } from "../../../utils/arrays";
import { useLocalEcho } from "../../../hooks/useLocalEcho";
import dis from "../../../dispatcher/dispatcher";
import { ROOM_SECURITY_TAB } from "../dialogs/RoomSettingsDialog";

interface IProps {
    room: Room;
    promptUpgrade?: boolean;
    closeSettingsFn(): void;
    onError(error: Error): void;
    beforeChange?(joinRule: JoinRule): Promise<boolean>; // if returns false then aborts the change
}

const JoinRuleSettings = ({ room, promptUpgrade, onError, beforeChange, closeSettingsFn }: IProps) => {
    const cli = room.client;

    const restrictedRoomCapabilities = SpaceStore.instance.restrictedJoinRuleSupport;
    const roomSupportsRestricted = Array.isArray(restrictedRoomCapabilities?.support)
        && restrictedRoomCapabilities.support.includes(room.getVersion());
    const preferredRestrictionVersion = !roomSupportsRestricted && promptUpgrade
        ? restrictedRoomCapabilities?.preferred
        : undefined;

    const disabled = !room.currentState.mayClientSendStateEvent(EventType.RoomJoinRules, cli);

    const [content, setContent] = useLocalEcho<IJoinRuleEventContent>(
        () => room.currentState.getStateEvents(EventType.RoomJoinRules, "")?.getContent(),
        content => cli.sendStateEvent(room.roomId, EventType.RoomJoinRules, content, ""),
        onError,
    );

    const { join_rule: joinRule } = content;
    const restrictedAllowRoomIds = joinRule === JoinRule.Restricted
        ? content.allow.filter(o => o.type === RestrictedAllowType.RoomMembership).map(o => o.room_id)
        : undefined;

    const editRestrictedRoomIds = async (): Promise<string[] | undefined> => {
        let selected = restrictedAllowRoomIds;
        if (!selected?.length && SpaceStore.instance.activeSpace) {
            selected = [SpaceStore.instance.activeSpace.roomId];
        }

        const matrixClient = MatrixClientPeg.get();
        const { finished } = Modal.createTrackedDialog('Edit restricted', '', ManageRestrictedJoinRuleDialog, {
            matrixClient,
            room,
            selected,
        }, "mx_ManageRestrictedJoinRuleDialog_wrapper");

        const [roomIds] = await finished;
        return roomIds;
    };

    const definitions: IDefinition<JoinRule>[] = [{
        value: JoinRule.Invite,
        label: _t("Private (invite only)"),
        description: _t("Only invited people can join."),
        checked: joinRule === JoinRule.Invite || (joinRule === JoinRule.Restricted && !restrictedAllowRoomIds?.length),
    }, {
        value: JoinRule.Public,
        label: _t("Public"),
        description: _t("Anyone can find and join."),
    }];

    if (roomSupportsRestricted || preferredRestrictionVersion || joinRule === JoinRule.Restricted) {
        let upgradeRequiredPill;
        if (preferredRestrictionVersion) {
            upgradeRequiredPill = <span className="mx_JoinRuleSettings_upgradeRequired">
                { _t("Upgrade required") }
            </span>;
        }

        let description;
        if (joinRule === JoinRule.Restricted && restrictedAllowRoomIds?.length) {
            // only show the first 4 spaces we know about, so that the UI doesn't grow out of proportion there are lots.
            const shownSpaces = restrictedAllowRoomIds
                .map(roomId => cli.getRoom(roomId))
                .filter(room => room?.isSpaceRoom())
                .slice(0, 4);

            let moreText;
            if (shownSpaces.length < restrictedAllowRoomIds.length) {
                if (shownSpaces.length > 0) {
                    moreText = _t("& %(count)s more", {
                        count: restrictedAllowRoomIds.length - shownSpaces.length,
                    });
                } else {
                    moreText = _t("Currently, %(count)s spaces have access", {
                        count: restrictedAllowRoomIds.length,
                    });
                }
            }

            const onRestrictedRoomIdsChange = (newAllowRoomIds: string[]) => {
                if (!arrayHasDiff(restrictedAllowRoomIds || [], newAllowRoomIds)) return;

                if (!newAllowRoomIds.length) {
                    setContent({
                        join_rule: JoinRule.Invite,
                    });
                    return;
                }

                setContent({
                    join_rule: JoinRule.Restricted,
                    allow: newAllowRoomIds.map(roomId => ({
                        "type": RestrictedAllowType.RoomMembership,
                        "room_id": roomId,
                    })),
                });
            };

            const onEditRestrictedClick = async () => {
                const restrictedAllowRoomIds = await editRestrictedRoomIds();
                if (!Array.isArray(restrictedAllowRoomIds)) return;
                if (restrictedAllowRoomIds.length > 0) {
                    onRestrictedRoomIdsChange(restrictedAllowRoomIds);
                } else {
                    onChange(JoinRule.Invite);
                }
            };

            description = <div>
                <span>
                    { _t("Anyone in a space can find and join. <a>Edit which spaces can access here.</a>", {}, {
                        a: sub => <AccessibleButton
                            disabled={disabled}
                            onClick={onEditRestrictedClick}
                            kind="link"
                        >
                            { sub }
                        </AccessibleButton>,
                    }) }
                </span>

                <div className="mx_JoinRuleSettings_spacesWithAccess">
                    <h4>{ _t("Spaces with access") }</h4>
                    { shownSpaces.map(room => {
                        return <span key={room.roomId}>
                            <RoomAvatar room={room} height={32} width={32} />
                            { room.name }
                        </span>;
                    }) }
                    { moreText && <span>{ moreText }</span> }
                </div>
            </div>;
        } else if (SpaceStore.instance.activeSpace) {
            description = _t("Anyone in <spaceName/> can find and join. You can select other spaces too.", {}, {
                spaceName: () => <b>{ SpaceStore.instance.activeSpace.name }</b>,
            });
        } else {
            description = _t("Anyone in a space can find and join. You can select multiple spaces.");
        }

        definitions.splice(1, 0, {
            value: JoinRule.Restricted,
            label: <>
                { _t("Space members") }
                { upgradeRequiredPill }
            </>,
            description,
            // if there are 0 allowed spaces then render it as invite only instead
            checked: joinRule === JoinRule.Restricted && !!restrictedAllowRoomIds?.length,
        });
    }

    const onChange = async (joinRule: JoinRule) => {
        const beforeJoinRule = content.join_rule;

        let restrictedAllowRoomIds: string[];
        if (joinRule === JoinRule.Restricted) {
            if (beforeJoinRule === JoinRule.Restricted || roomSupportsRestricted) {
                // Have the user pick which spaces to allow joins from
                restrictedAllowRoomIds = await editRestrictedRoomIds();
                if (!Array.isArray(restrictedAllowRoomIds)) return;
            } else if (preferredRestrictionVersion) {
                // Block this action on a room upgrade otherwise it'd make their room unjoinable
                const targetVersion = preferredRestrictionVersion;

                const modal = Modal.createTrackedDialog('Restricted join rule upgrade', '', RoomUpgradeWarningDialog, {
                    roomId: room.roomId,
                    targetVersion,
                    description: _t("This upgrade will allow members of selected spaces " +
                        "access to this room without an invite."),
                });

                const [resp] = await modal.finished;
                if (!resp?.continue) return;

                const userId = cli.getUserId();
                const unableToUpdateSomeParents = Array.from(SpaceStore.instance.getKnownParents(room.roomId))
                    .some(roomId => !cli.getRoom(roomId)?.currentState.maySendStateEvent(EventType.SpaceChild, userId));
                if (unableToUpdateSomeParents) {
                    const modal = Modal.createTrackedDialog<[boolean]>('Parent relink warning', '', QuestionDialog, {
                        title: _t("Before you upgrade"),
                        description: (
                            <div>{ _t("This room is in some spaces you’re not an admin of. " +
                                "In those spaces, the old room will still be shown, " +
                                "but people will be prompted to join the new one.") }</div>
                        ),
                        hasCancelButton: true,
                        button: _t("Upgrade anyway"),
                        danger: true,
                    });

                    const [shouldUpgrade] = await modal.finished;
                    if (!shouldUpgrade) return;
                }

                const roomId = await upgradeRoom(room, targetVersion, resp.invite, true, true, true);
                closeSettingsFn();
                // switch to the new room in the background
                dis.dispatch({
                    action: "view_room",
                    room_id: roomId,
                });
                // open new settings on this tab
                dis.dispatch({
                    action: "open_room_settings",
                    initial_tab_id: ROOM_SECURITY_TAB,
                });

                return;
            }

            // when setting to 0 allowed rooms/spaces set to invite only instead as per the note
            if (!restrictedAllowRoomIds.length) {
                joinRule = JoinRule.Invite;
            }
        }

        if (beforeJoinRule === joinRule && !restrictedAllowRoomIds) return;
        if (beforeChange && !(await beforeChange(joinRule))) return;

        const newContent: IJoinRuleEventContent = {
            join_rule: joinRule,
        };

        // pre-set the accepted spaces with the currently viewed one as per the microcopy
        if (joinRule === JoinRule.Restricted) {
            newContent.allow = restrictedAllowRoomIds.map(roomId => ({
                "type": RestrictedAllowType.RoomMembership,
                "room_id": roomId,
            }));
        }

        setContent(newContent);
    };

    return (
        <StyledRadioGroup
            name="joinRule"
            value={joinRule}
            onChange={onChange}
            definitions={definitions}
            disabled={disabled}
        />
    );
};

export default JoinRuleSettings;
