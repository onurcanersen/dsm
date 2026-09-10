from setuptools import find_packages, setup

setup(
    name="vae",
    version="0.1.0",
    description="DSM-VAE: Design Verification, Analysis and Evaluation",
    python_requires=">=3.8",
    package_dir={"": "src"},
    packages=find_packages(where="src"),
    install_requires=[
        "Flask==2.3.2",
        "celery==5.2.3",
        "redis==4.1.1",
        "docker==7.1.0",
        "msd",
    ],
    entry_points={"console_scripts": ["dsm=vae.__main__:main"]},
    package_data={
        "vae": [
            "vae.ini",
            "templates/*.html",
            "static/*",
            "static/fonts/*",
            "static/img/*",
        ]
    },
    include_package_data=True,
)
