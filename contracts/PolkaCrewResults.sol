// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Consensus-attested match registry for PolkaCrew on Asset Hub / PolkaVM.
/// @dev Every participant must attest from their own account before stats are finalized.
/// @custom:cdm @w3nerick/polkacrew-results
contract PolkaCrewResults {
    enum Winner { Crew, Saboteur }

    struct Stats {
        uint64 games;
        uint64 wins;
        uint64 crewWins;
        uint64 saboteurWins;
        uint128 xp;
    }

    struct MatchHeader {
        string replayCid;
        Winner winner;
        uint32 playerCount;
        uint32 attestations;
        uint64 createdAt;
        bool finalized;
    }

    mapping(bytes32 => MatchHeader) public matches;
    mapping(bytes32 => address[]) private matchParticipants;
    mapping(bytes32 => mapping(address => bool)) public isParticipant;
    mapping(bytes32 => mapping(address => bool)) public participantWon;
    mapping(bytes32 => mapping(address => bool)) public attested;
    mapping(address => Stats) public stats;

    event MatchProposed(bytes32 indexed matchId, string replayCid, Winner winner, uint32 playerCount);
    event MatchAttested(bytes32 indexed matchId, address indexed participant, uint32 attestations);
    event MatchFinalized(bytes32 indexed matchId, string replayCid, Winner winner);

    error MatchExists();
    error InvalidParticipants();
    error NotParticipant();
    error AlreadyAttested();
    error AlreadyFinalized();

    function proposeMatch(
        bytes32 matchId,
        string calldata replayCid,
        Winner winner,
        address[] calldata participants,
        bool[] calldata won
    ) external {
        if (matches[matchId].createdAt != 0) revert MatchExists();
        if (participants.length < 2 || participants.length > 10 || participants.length != won.length) revert InvalidParticipants();
        if (bytes(replayCid).length == 0) revert InvalidParticipants();

        bool senderIncluded;
        for (uint256 i = 0; i < participants.length; i++) {
            address participant = participants[i];
            if (participant == address(0) || isParticipant[matchId][participant]) revert InvalidParticipants();
            isParticipant[matchId][participant] = true;
            participantWon[matchId][participant] = won[i];
            matchParticipants[matchId].push(participant);
            if (participant == msg.sender) senderIncluded = true;
        }
        if (!senderIncluded) revert NotParticipant();

        matches[matchId] = MatchHeader({
            replayCid: replayCid,
            winner: winner,
            playerCount: uint32(participants.length),
            attestations: 0,
            createdAt: uint64(block.timestamp),
            finalized: false
        });

        emit MatchProposed(matchId, replayCid, winner, uint32(participants.length));
    }

    function attestMatch(bytes32 matchId) external {
        MatchHeader storage m = matches[matchId];
        if (m.finalized) revert AlreadyFinalized();
        if (!isParticipant[matchId][msg.sender]) revert NotParticipant();
        if (attested[matchId][msg.sender]) revert AlreadyAttested();

        attested[matchId][msg.sender] = true;
        m.attestations += 1;
        emit MatchAttested(matchId, msg.sender, m.attestations);

        if (m.attestations == m.playerCount) _finalize(matchId, m);
    }

    function participants(bytes32 matchId) external view returns (address[] memory) {
        return matchParticipants[matchId];
    }

    function _finalize(bytes32 matchId, MatchHeader storage m) internal {
        m.finalized = true;
        address[] storage ps = matchParticipants[matchId];
        for (uint256 i = 0; i < ps.length; i++) {
            address participant = ps[i];
            Stats storage s = stats[participant];
            s.games += 1;
            s.xp += participantWon[matchId][participant] ? 125 : 40;
            if (participantWon[matchId][participant]) {
                s.wins += 1;
                if (m.winner == Winner.Crew) s.crewWins += 1;
                else s.saboteurWins += 1;
            }
        }
        emit MatchFinalized(matchId, m.replayCid, m.winner);
    }
}
