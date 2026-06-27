"""打印前 20 个质数"""

def is_prime(n: int) -> bool:
    """判断一个正整数是否为质数"""
    if n < 2:
        return False
    if n == 2:
        return True
    if n % 2 == 0:
        return False
    # 只需检查奇数因子，范围到 sqrt(n)
    i = 3
    while i * i <= n:
        if n % i == 0:
            return False
        i += 2
    return True


def main():
    count = 0
    num = 2
    primes = []

    while count < 20:
        if is_prime(num):
            primes.append(num)
            count += 1
        num += 1

    print("First 20 prime numbers:")
    print(primes)


if __name__ == "__main__":
    main()
