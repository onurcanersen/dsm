from setuptools import find_packages, setup

setup(
    name="msd",
    version="0.1.0",
    description="DSM-MSD: Model Setup Data Generation",
    python_requires=">=3.8",
    package_dir={"": "src"},
    packages=find_packages(where="src"),
    install_requires=[
        "PyMySQL[rsa]==1.0.3",
        "pandas==2.0.1",
    ],
    package_data={"msd": ["msd.ini"]},
    include_package_data=True,
)
