# Raft: A Consensus Algorithm for Replicated Logs

Raft is a consensus algorithm designed to manage a replicated log across a cluster of servers. It
was created by Diego Ongaro and John Ousterhout at Stanford University and described in their 2014
USENIX ATC paper, "In Search of an Understandable Consensus Algorithm." Raft was designed from the
start with understandability as a primary goal, in contrast to the earlier Paxos algorithm, which is
widely regarded as difficult to reason about and implement correctly.

## Server states

At any given time, each server in a Raft cluster is in one of three states: leader, follower, or
candidate. In normal operation there is exactly one leader and all of the other servers are
followers. Followers are passive: they issue no requests on their own and simply respond to requests
from leaders and candidates. The leader handles all client requests; if a client contacts a follower,
the follower redirects it to the leader.

## Terms and elections

Raft divides time into terms of arbitrary length, numbered with consecutive integers. Each term
begins with an election, in which one or more candidates attempt to become leader. A candidate that
wins an election serves as leader for the rest of the term. Every server stores a current term
number, which increases monotonically over time. Servers exchange their current term number in every
communication, and a server that discovers its term is out of date immediately updates it. At most
one leader can be elected in a given term, a property enforced by requiring a candidate to receive
votes from a majority of the servers in the cluster before it can become leader.

To begin an election, a follower increments its current term and transitions to the candidate state.
It votes for itself and issues RequestVote remote procedure calls in parallel to the other servers in
the cluster. A candidate continues in this state until one of three things happens: it wins the
election, another server establishes itself as leader, or a period of time goes by with no winner.
Election timeouts are randomized, chosen from a fixed interval, which makes split votes rare and
ensures one candidate usually becomes leader quickly.

## Log replication

Once a leader has been elected, it begins servicing client requests. Each client request contains a
command to be executed by the replicated state machines. The leader appends the command to its log as
a new entry, then issues AppendEntries remote procedure calls in parallel to the other servers to
replicate the entry. When the entry has been safely replicated, the leader applies the entry to its
own state machine and returns the result to the client. If followers crash or run slowly, or if
network packets are lost, the leader retries AppendEntries RPCs indefinitely, even after it has
responded to the client, until all followers eventually store all log entries.

A log entry is committed once the leader that created the entry has replicated it on a majority of
the servers. This also commits all prior entries in the leader's log, including entries created by
previous leaders. The leader keeps track of the highest index it knows to be committed, and it
includes that index in future AppendEntries RPCs so that other servers eventually find out.

## Safety

Raft's leader election restriction guarantees that the leader for any given term contains all of the
entries committed in previous terms. A candidate cannot win an election unless its log contains all
committed entries, because voters deny their vote to candidates whose logs are less up to date than
their own. Combined with the commitment rule, this ensures the Leader Completeness Property: if a log
entry is committed in a given term, then that entry will be present in the logs of the leaders for
all higher-numbered terms. This property is central to Raft's safety guarantees and to keeping the
replicated state machines consistent.

## Heartbeats

Leaders send periodic heartbeats, which are AppendEntries RPCs that carry no log entries, to all
followers in order to maintain their authority and prevent new elections from being triggered by
follower election timeouts. As long as a leader continues to send heartbeats before followers' timers
expire, it retains leadership.
