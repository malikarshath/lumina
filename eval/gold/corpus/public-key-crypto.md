# Public-Key Cryptography: Diffie-Hellman and RSA

Public-key cryptography, also called asymmetric cryptography, uses a pair of mathematically related
keys, a public key and a private key, instead of a single shared secret key. The public key can be
distributed openly and used to encrypt a message or verify a signature, while the private key is kept
secret by its owner and used to decrypt messages or create signatures. This solves a problem that had
plagued symmetric cryptography for centuries: two parties who have never met need a way to establish a
shared secret over a channel that an adversary might be listening to.

## Diffie-Hellman key exchange

The Diffie-Hellman key exchange was published in 1976 by Whitfield Diffie and Martin Hellman, building
on ideas from Ralph Merkle, in a paper titled "New Directions in Cryptography." It was the first
published practical method for two parties to establish a shared secret over an insecure channel
without having any prior shared information. The method relies on modular exponentiation: both parties
agree publicly on a large prime number and a base, each choose a secret random number, and each
computes and exchanges a public value derived by raising the base to their secret power, modulo the
agreed prime. Each party then raises the other's public value to their own secret power, and by the
properties of modular exponentiation, both arrive at the same shared secret, which an eavesdropper
who only sees the exchanged public values cannot feasibly compute, a problem known as the discrete
logarithm problem.

## RSA

RSA was published in 1977 by Ron Rivest, Adi Shamir, and Leonard Adleman at MIT, and its name is formed
from the initials of their surnames. Unlike Diffie-Hellman, which is a key-exchange method, RSA is a
full public-key encryption and digital signature scheme. Its security rests on the practical difficulty
of factoring the product of two large prime numbers. To generate an RSA key pair, two large primes p
and q are chosen and multiplied to form a modulus n; a public exponent e is chosen, and a private
exponent d is computed such that encrypting with e and then decrypting with d (or vice versa) recovers
the original message, using arithmetic modulo n. The public key is the pair (n, e) and the private key
is (n, d). Because factoring n back into p and q is computationally infeasible for sufficiently large
primes using known classical algorithms, an attacker who knows only the public key cannot feasibly
derive the private key.

## Historical footnote

Interestingly, an equivalent method to RSA had been developed in 1973 by Clifford Cocks, a
mathematician at the British intelligence agency GCHQ, but it was classified and remained secret until
1997, well after RSA had been published and had become an industry standard, so it had no influence on
the field's development.

## Applications

Public-key cryptography underlies much of modern secure communication. TLS, the protocol that secures
HTTPS web traffic, uses public-key techniques (historically often RSA, and increasingly variants of
Diffie-Hellman such as elliptic-curve Diffie-Hellman) to establish a shared session key between a
browser and a server, which is then used with faster symmetric encryption for the rest of the session.
Public-key cryptography is also the basis for digital signatures, which let a recipient verify that a
message genuinely came from the claimed sender and was not altered in transit.
