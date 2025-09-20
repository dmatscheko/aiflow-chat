import random

class Game:
    def __init__(self, min_num=1, max_num=100):
        self.min_num = min_num
        self.max_num = max_num
        self.target = random.randint(min_num, max_num)
        self.guesses = 0
        self.game_over = False
        self.won = False

    def make_guess(self, guess):
        if self.game_over:
            return "Game is already over."

        self.guesses += 1
        if guess < self.target:
            return "Higher!"
        elif guess > self.target:
            return "Lower!"
        else:
            self.game_over = True
            self.won = True
            return f"Correct! You guessed it in {self.guesses} attempts."

    def reset(self):
        self.target = random.randint(self.min_num, self.max_num)
        self.guesses = 0
        self.game_over = False
        self.won = False


class Player:
    @staticmethod
    def get_guess():
        while True:
            try:
                return int(input("Enter your guess: "))
            except ValueError:
                print("Please enter a valid integer.")


def game_loop():
    game = Game()
    player = Player()

    print(f"Welcome to the Guessing Game! I'm thinking of a number between {game.min_num} and {game.max_num}.")

    while not game.game_over:
        feedback = game.make_guess(player.get_guess())
        print(feedback)

    if game.won:
        print("🎉 Congratulations! You've won!")
    else:
        print("Game over.")

    play_again = input("Play again? (y/n): ").strip().lower()
    if play_again in ['y', 'yes']:
        game_loop()
    else:
        print("Thanks for playing!")


if __name__ == "__main__":
    game_loop()