# 2PC - Two-Party Commitment

*"I'll show you mine if you show me yours."* but make it cryptography.

2PC is a web app that lets two people (Alice and Bob) commit to messages **simultaneously** so that neither can cheat. 
Think of it as a cryptographic coin flip, sealed envelope, or pinky promise -- except it actually works.

## Why?

Ever needed to make a fair decision with someone over the internet?

- Agree on a price for a used LEGO set? 
  Sell commits to minimum price, buyer to maximum price, take the average.
- Playing rock-paper-scissors remotely? 
  Commit your move, reveal together.
- Agreeing on a meeting time without anchoring bias? 
  Commit first, argue later.

The **commitment protocol** guarantees that once you commit to a message, you can't change it.
You won't see the other person's message until both of you have committed.

## Theory

If you are interested in the different levels of mutually independent commitments, see [_Mutually Independent Commitments_](https://www.cs.bu.edu/~reyzin/papers/commitments.pdf) by Liskov et.al. 
Note that our implementation is **hiding** and **binding** but does not guarantee **non-correlation** in their notation.
To provide at least **mutually independent announcement**, we would need to enforce a reveal order which we currently don't do.

## How It Works

```
Alice                                          Bob
  |                                              |
  |-- generates shared secret, sends link ------>|
  |                                              |
  |<====== encrypted WebSocket channel =========>|
  |    (X25519 key exchange + AES-GCM)           |
  |                                              |
  |-- commit(SHA-256(message || random)) ------->|
  |<------- commit(SHA-256(message || random)) --|
  |                                              |
  |-- reveal(message, random) ------------------>|
  |<----------------- reveal(message, random) --|
  |                                              |
  |  both verify: SHA-256(msg || rand) == commit |
  \______________________________________________/
                       done!
```

1. **Alice** visits the app and gets a link to share with Bob.
2. **Bob** opens the link. 
   An encrypted channel is established automatically.
3. Both type their messages and hit **Commit**. 
   A SHA-256 hash locks in their choice.
4. Once both have committed, they **Reveal**. 
   The app verifies that neither party changed their message.

There is _no_ server-side storage and the server never sees the commitment or message.

## License

MIT -- see [LICENSE](LICENSE).
